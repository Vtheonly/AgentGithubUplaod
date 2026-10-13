// ============================================================================
// FILE: src/domain/calc/payment/webhook-diagnostics.ts
// ============================================================================
/**
 * Webhook & Ledger Traceability Diagnostics — T-511 (AUDIT-506, issue #30,
 * 159th session 2026-10-13).
 *
 * CLASSIFICATION (AGENTS.md §15.53a, binding): this module is an ANALYTICAL
 * layer — a READ-ONLY whole-books audit that is a CONSUMER of the canonical
 * engines, never a second implementation of any financial rule:
 *   - account balances      ← computeParentSummary (the canonical ledger replay)
 *   - tranche remaining     ← installmentRemaining (the INV-4 formula)
 *   - price basis           ← REAL_TUITION_BY_GRADE / realFiForGrade (the
 *                             school price matrix, T-425's official model)
 *                             — with the ACTIVE PricingConfig preferred when
 *                             supplied (T-529: the configured-price truth)
 *
 * ALL-ORIGINS CHARTER (T-529 / AUDIT-509, the owner's mandate): the audit is
 * origin-blind BY CONSTRUCTION — every row of every stream is audited
 * regardless of how it entered the system: the Excel bulk import, the
 * manual registration flow (register_family_batch / re-enrollment), manual
 * entry through the app's own interface, the Edge-Function collection &
 * refund paths, and the counter RPCs. The charge identity forms censused
 * on the live books (the §15.105 census rule, made standing here):
 *   (A) sourceType='installment' + installments PK      — the import path;
 *   (B) sourceType='installment' + `reg-<code>[-transport]-t<n>`/`-fi`
 *       — the registration business identity (0102/0103/0128);
 *   (C) sourceType='bulk_import' + `<studentId>:<FIELD>` — the import stems;
 *   (D) sourceType='manual_entry' + `reg-<parentCode>-fee` — the
 *       registration FI fee (family-level, « nouvelle famille »).
 * (A)/(B) flow through the charge→installment resolution (both forms,
 * T-528); (C)/(D) flow through the description/metadata justification gate.
 * The report's `coverage.chargeForms` counts each form so the coverage
 * claim is CHECKABLE, never aspirational.
 *
 * MANDATE (issue #30): determine whether every financial transaction and
 * ledger entry is legitimate, correctly mapped, and traceable to a concrete
 * business event. A technically-successful event can still record the wrong
 * amount, link money to the wrong customer, duplicate itself, or create a
 * charge no service or agreed price explains. The engine must surface ANY
 * amount of money that cannot be traced to a specific, supported reason.
 *
 * In THIS system there is no literal "webhook" concept: the term maps to the
 * financial event sources — counter collections through the canonical RPCs,
 * the Excel import's bulk writes, the Edge-Function collection/refund paths,
 * and the audit trail. The audit treats every Payment / LedgerEntry /
 * Installment / PaymentAllocation row as the persisted outcome of such an
 * event and traces it back to its source.
 *
 * READ-ONLY SAFETY (the issue's hard constraint):
 *   - PURE function: takes plain arrays, returns a report. No repository,
 *     no RPC, no mutation of ANY input record (frozen-copy test-pinned).
 *   - Never infers or fabricates missing prices, services, source links or
 *     payment dates — missing evidence is reported as `unverified`.
 *   - Never labels a record fraudulent: incomplete evidence = "unverified",
 *     a material deviation = "outlier_review" (requiring human review).
 *   - Proposed corrections ride the EXISTING workflows; this engine only
 *     explains what evidence is missing and what to investigate.
 *
 * All functions are pure and total. The clock is INJECTED (`now`) — never a
 * hidden `Date.now()` (the §15.49d lesson).
 */
import type {
  Payment,
  Installment,
  PaymentAllocation,
  DebtSummary,
} from "../../model/payment";
import type { LedgerEntry } from "../../model/ledger";
import type { Parent } from "../../model/parent";
import type { Student, GradeLevel } from "../../model/student";
import { parentDisplayName } from "../../model/parent";
import { installmentRemaining } from "./queries";
import { computeParentSummary } from "../ledger/balance";
import {
  REAL_TUITION_BY_GRADE,
  realFiForGrade,
  type RealTuitionSchedule,
} from "../pricing/school-price-matrix";

/* ================================================================== */
/*  Findings taxonomy (issue #30's mandated categories)                */
/* ================================================================== */

export type WebhookFindingCategory =
  /** Source and ledger values conflict (amount/status/customer/identity). */
  | "confirmed_mismatch"
  /** The same business event appears to have been processed more than once. */
  | "duplicate_event"
  /** No concrete service/source or defensible price basis can be established. */
  | "unjustified_amount"
  /** Materially inconsistent with the price schedule / documented terms. */
  | "outlier_review"
  /** Payment status and date do not make sense together / as-of balance skew. */
  | "date_semantic_conflict"
  /** Not enough source data to determine legitimacy (never "fraudulent"). */
  | "unverified"
  /** The records agree and the amount has a traceable justification. */
  | "reconciled";

export type WebhookFindingSeverity = "critical" | "warning" | "info" | "ok";

/** One exact value compared as part of a finding's evidence. */
export interface WebhookEvidenceItem {
  /** What this value is (e.g. « Paiement REC-2025-000123 »). */
  readonly label: string;
  /** The exact value (pre-formatted; amounts carry their DZD suffix). */
  readonly value: string;
  /** Stable reference to the record it came from (e.g. `payments:PAY-1`). */
  readonly sourceRef: string | null;
}

/** The record IDs a finding implicates (all optional — present when known). */
export interface WebhookFindingRecordIds {
  readonly payment?: string;
  readonly ledgerEntry?: string;
  readonly installment?: string;
  readonly allocation?: string;
  readonly receiptNumber?: string;
}

/**
 * One diagnostic finding — the unit the UI renders. Every actionable finding
 * carries the exact values, the calculation, the source references, and the
 * suggested investigation steps (issue #30: "show the source evidence,
 * calculation, conflicting values, severity, and why the record is flagged").
 */
export interface WebhookDiagnosticFinding {
  /** Stable: `<category>:<primary-record-id>` (unique per audit run). */
  readonly id: string;
  readonly category: WebhookFindingCategory;
  readonly severity: WebhookFindingSeverity;
  readonly parentId: string | null;
  readonly parentName: string | null;
  /** The DZD amount at stake, when quantifiable. */
  readonly amount: number | null;
  readonly currency: "DZD";
  readonly recordIds: WebhookFindingRecordIds;
  /** Source references (sourceType/sourceId pairs, import keys, receipt nos). */
  readonly sourceRefs: readonly string[];
  /** Short FR title (the finding's class in one line). */
  readonly title: string;
  /** FR explanation — WHAT was compared, WHAT conflicts, WHY it is flagged. */
  readonly explanation: string;
  /** The exact values compared (evidence inventory). */
  readonly evidence: readonly WebhookEvidenceItem[];
  /** The arithmetic, when a numeric comparison drives the finding. */
  readonly calculation: string | null;
  /**
   * T-529 (the owner's 7-point mandate, dimension 6): the PLAUSIBLE CAUSES
   * of the finding — hypotheses with their supporting evidence, NEVER
   * asserted as facts (the read-only charter: the engine explains, the
   * owner rules). Empty for reconciled rows (nothing to explain).
   */
  readonly possibleCauses?: readonly string[];
  /** Suggested investigation steps (FR) — never an automatic correction. */
  readonly suggestedSteps: readonly string[];
}

/* ================================================================== */
/*  Configurable thresholds (issue #30: never hard-code the examples)  */
/* ================================================================== */

export interface WebhookDiagnosticsThresholds {
  /**
   * A payment whose `collectedAt` is more than this many days in the future
   * is "future-dated" (small clock-skew tolerance). Default 1.
   */
  readonly futureDateGraceDays: number;
  /**
   * An imported tuition total greater than this multiple of the expected
   * price-matrix schedule is an outlier requiring review. Default 2 (the
   * issue's illustrative 2,645,000 vs ~260,000 case — a CONFIGURABLE
   * material-deviation flag, never a universal accounting rule).
   */
  readonly quoteOutlierMultiplier: number;
  /**
   * A single tranche absorbing more than this fraction of the student's
   * annual tuition total is "concentrated" (the silent-delta-absorption
   * detector). Default 0.5 — the official schedule is 40/30/30, so any
   * tranche above half the total is structurally anomalous.
   */
  readonly trancheConcentrationRatio: number;
  /**
   * Absolute DZD tolerance for float-artifact absorption in amount
   * comparisons. Default 1 (DZD has no working sub-unit precision).
   */
  readonly amountToleranceDzd: number;
}

export const DEFAULT_WEBHOOK_DIAGNOSTICS_THRESHOLDS: WebhookDiagnosticsThresholds =
  {
    futureDateGraceDays: 1,
    quoteOutlierMultiplier: 2,
    trancheConcentrationRatio: 0.5,
    amountToleranceDzd: 1,
  };

/* ================================================================== */
/*  The configured price catalog (T-529 / AUDIT-510)                   */
/* ================================================================== */

/**
 * The structural subset of the ACTIVE `PricingConfig` the audit consumes
 * (the owner's mandate: compare against "the prices defined in the
 * application's configuration", not the hardcoded matrix). The desktop's
 * full PricingConfig satisfies this structurally; tests may pass literals.
 */
export interface WebhookDiagnosticsPricingConfig {
  /** The flat family registration fee (the LEGACY `registrationFee`). */
  readonly registrationFee: number;
  /** The per-grade per-student registration fee (the workbook convention). */
  readonly registrationFeeByGrade: Readonly<Record<string, number>>;
  /** The per-grade tuition grid (annual + the 3 installments). */
  readonly tuitionByGradeLevel?: Readonly<
    Record<string, { readonly annualAmount: number; readonly installments: readonly [number, number, number] }>
  >;
}

/* ================================================================== */
/*  Report shape                                                       */
/* ================================================================== */

export interface WebhookDiagnosticsCoverage {
  readonly payments: number;
  readonly ledgerEntries: number;
  readonly installments: number;
  readonly allocations: number;
  readonly parents: number;
  /** T-529: the price catalog was supplied — the configured-price checks ran. */
  readonly pricingConfig: boolean;
  /** T-529 (AUDIT-509): the charge identity-form census (A/B/C/D + other). */
  readonly chargeForms: Readonly<Record<ChargeSourceForm, number>>;
}

/** The charge source identity forms (the all-origins census). */
export type ChargeSourceForm =
  | "installment-pk" // (A) the import path — source_id IS the installments PK
  | "installment-reg-identity" // (B) the registration business identity
  | "bulk-import-stem" // (C) `<studentId>:<FIELD>` — the Excel import stems
  | "manual-entry" // (D) manual entries (the registration fee stem, …)
  | "other"; // anything else — still audited through the description gate

export type WebhookFindingCounts = Record<WebhookFindingCategory, number>;

export interface WebhookDiagnosticsReport {
  /** The injected audit clock (ISO) — every date comparison is anchored here. */
  readonly asOf: string;
  readonly thresholds: WebhookDiagnosticsThresholds;
  readonly coverage: WebhookDiagnosticsCoverage;
  readonly counts: WebhookFindingCounts;
  /** Every finding INCLUDING `reconciled` rows (the UI filters/paginates). */
  readonly findings: readonly WebhookDiagnosticFinding[];
}

/* ================================================================== */
/*  FR labels (the app's UI language)                                  */
/* ================================================================== */

export const WEBHOOK_FINDING_CATEGORY_LABELS_FR: Record<
  WebhookFindingCategory,
  string
> = {
  confirmed_mismatch: "Conflit confirmé",
  duplicate_event: "Doublon d'événement",
  unjustified_amount: "Montant non justifié",
  outlier_review: "Anomalie à examiner",
  date_semantic_conflict: "Conflit de dates",
  unverified: "Non vérifiable",
  reconciled: "Réconcilié",
};

export const WEBHOOK_FINDING_SEVERITY_LABELS_FR: Record<
  WebhookFindingSeverity,
  string
> = {
  critical: "Critique",
  warning: "Avertissement",
  info: "Info",
  ok: "Sain",
};

/** Generic-description vocabulary — a vague label is NOT price evidence. */
const GENERIC_DESCRIPTION_PATTERNS: readonly RegExp[] = [
  /^(divers|autre|autre[s]? frais|ajustement|régularisation|regularisation|correction|solde|équilibre|equilibre|manuel|année|frais)$/i,
  /^(paiement|versement|règlement|reglement)$/i,
  /^-+$/,
  /^(x+|\.+|\*+)$/,
];

/**
 * Is this description too generic to establish legitimacy on its own?
 * (issue #30 Example C: "A generic description alone is not enough to
 * establish legitimacy.")
 */
export function isGenericFinancialDescription(description: string | null | undefined): boolean {
  if (!description) return true;
  const trimmed = description.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 4) return true;
  return GENERIC_DESCRIPTION_PATTERNS.some((p) => p.test(trimmed));
}

/** Integer DZD formatting for evidence strings (fr-FR grouping). */
function dzd(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} DZD`;
}

function isoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

/* ================================================================== */
/*  Internal context (pre-grouped indexes — built once per audit run)  */
/* ================================================================== */

interface AuditContext {
  readonly nowMs: number;
  readonly thresholds: WebhookDiagnosticsThresholds;
  readonly payments: readonly Payment[];
  readonly installments: readonly Installment[];
  readonly ledgerEntries: readonly LedgerEntry[];
  readonly allocations: readonly PaymentAllocation[];
  readonly parents: readonly Parent[];
  readonly students: readonly Student[];
  readonly debtSummaries: readonly DebtSummary[];
  /** T-529: the configured price catalog (null = not supplied). */
  readonly pricingConfig: WebhookDiagnosticsPricingConfig | null;
  /** T-529 (AUDIT-509): the charge identity-form census (all-origins proof). */
  readonly chargeForms: Record<ChargeSourceForm, number>;
  // Indexes
  readonly paymentById: Map<string, Payment>;
  readonly installmentById: Map<string, Installment>;
  readonly studentById: Map<string, Student>;
  readonly parentById: Map<string, Parent>;
  readonly debtByParent: Map<string, DebtSummary>;
  /** type="payment" AND sourceType="payment" entries grouped by sourceId. */
  readonly ledgerPaymentsBySourceId: Map<string, LedgerEntry[]>;
  /** type="charge" AND sourceType="installment" entries grouped by sourceId. */
  readonly ledgerChargesByInstallmentId: Map<string, LedgerEntry[]>;
  readonly installmentsByStudent: Map<string, Installment[]>;
  /** Students by identity CODE (ELV-…) — the registration reg-identity's fallback token space (T-528). */
  readonly studentByCode: Map<string, Student>;
  readonly allocationsByPayment: Map<string, PaymentAllocation[]>;
  readonly displayName: (parentId: string | null) => string | null;
}

function buildAuditContext(params: {
  payments: readonly Payment[];
  installments: readonly Installment[];
  ledgerEntries: readonly LedgerEntry[];
  allocations: readonly PaymentAllocation[];
  debtSummaries: readonly DebtSummary[];
  parents: readonly Parent[];
  students: readonly Student[];
  pricingConfig: WebhookDiagnosticsPricingConfig | null;
  nowMs: number;
  thresholds: WebhookDiagnosticsThresholds;
}): AuditContext {
  const {
    payments, installments, ledgerEntries, allocations, debtSummaries,
    parents, students, pricingConfig, nowMs, thresholds,
  } = params;

  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const installmentById = new Map(installments.map((i) => [i.id, i]));
  const studentById = new Map(students.map((s) => [s.id, s]));
  const parentById = new Map(parents.map((p) => [p.id, p]));
  const debtByParent = new Map(debtSummaries.map((d) => [d.parentId, d]));

  const ledgerPaymentsBySourceId = new Map<string, LedgerEntry[]>();
  const ledgerChargesByInstallmentId = new Map<string, LedgerEntry[]>();
  for (const e of ledgerEntries) {
    if (e.type === "payment" && e.sourceType === "payment") {
      const list = ledgerPaymentsBySourceId.get(e.sourceId) ?? [];
      list.push(e);
      ledgerPaymentsBySourceId.set(e.sourceId, list);
    }
    if (e.type === "charge" && e.sourceType === "installment") {
      const list = ledgerChargesByInstallmentId.get(e.sourceId) ?? [];
      list.push(e);
      ledgerChargesByInstallmentId.set(e.sourceId, list);
    }
  }

  const installmentsByStudent = new Map<string, Installment[]>();
  for (const i of installments) {
    if (!i.studentId) continue;
    const list = installmentsByStudent.get(i.studentId) ?? [];
    list.push(i);
    installmentsByStudent.set(i.studentId, list);
  }

  // T-528 (AUDIT-507): students by identity CODE — the registration path's
  // `reg-<code>-t<n>` token carries the student CODE whenever the charge's
  // own studentId is absent, and the code is the resolvable token there.
  const studentByCode = new Map<string, Student>();
  for (const s of students) {
    if (s.code) studentByCode.set(s.code, s);
  }

  const allocationsByPayment = new Map<string, PaymentAllocation[]>();
  for (const a of allocations) {
    const list = allocationsByPayment.get(a.paymentId) ?? [];
    list.push(a);
    allocationsByPayment.set(a.paymentId, list);
  }

  // T-529 (AUDIT-509): the charge identity-form census — the all-origins
  // proof, counted over the REAL stream (the §15.105 census rule, standing).
  const chargeForms: Record<ChargeSourceForm, number> = {
    "installment-pk": 0,
    "installment-reg-identity": 0,
    "bulk-import-stem": 0,
    "manual-entry": 0,
    other: 0,
  };
  for (const e of ledgerEntries) {
    if (e.type !== "charge") continue;
    if (e.sourceType === "installment") {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.sourceId);
      if (isUuid) chargeForms["installment-pk"] += 1;
      else if (/^reg-/.test(e.sourceId)) chargeForms["installment-reg-identity"] += 1;
      else chargeForms.other += 1;
    } else if (e.sourceType === "bulk_import") {
      chargeForms["bulk-import-stem"] += 1;
    } else if (e.sourceType === "manual_entry") {
      chargeForms["manual-entry"] += 1;
    } else {
      chargeForms.other += 1;
    }
  }

  return {
    nowMs, thresholds, payments, installments, ledgerEntries, allocations,
    parents, students, debtSummaries, pricingConfig, chargeForms,
    paymentById, installmentById, studentById, parentById, debtByParent,
    ledgerPaymentsBySourceId, ledgerChargesByInstallmentId,
    installmentsByStudent, studentByCode, allocationsByPayment,
    displayName: (parentId) =>
      parentId === null
        ? null
        : parentById.has(parentId)
          ? parentDisplayName(parentById.get(parentId)!)
          : null,
  };
}

/* ================================================================== */
/*  Charge→installment resolution — the canonical identity forms      */
/*  (T-528 / AUDIT-507, the 172nd session)                             */
/*                                                                     */
/*  A charge entry stamped source_type='installment' may carry EITHER */
/*  canonical identity in its source_id:                               */
/*    (A) the installments table PK — the bulk-import path writes      */
/*        charges whose source_id IS installments.id;                  */
/*    (B) the registration path's deterministic BUSINESS identity      */
/*        `reg-<studentCodeOrUuid>[-transport]-t<n>` (tuition wave n),  */
/*        `reg-<studentCodeOrUuid>-transport-t<n>` (transport wave n)  */
/*        or `reg-…-fi` (the registration fee, wave 0) — migrations     */
/*        0102/0103/0128 (register_family_batch + the re-enrollment    */
/*        flow). This identity NEVER equals the installments PK: the   */
/*        installments rows carry UUID PKs plus their OWN              */
/*        `<code>:<category>:T<n>` source identity — three DIFFERENT   */
/*        identity spaces for the same business relationship.          */
/*                                                                     */
/*  Resolving through ONE space only (the pre-T-528 behavior) turned   */
/*  every form-B charge — i.e. every legitimate charge on a newly      */
/*  registered account — into a false CRITICAL « échéance introuvable » */
/*  (AUDIT-507). The resolver walks BOTH spaces, reusing the context's */
/*  EXISTING indexes (installmentById / installmentsByStudent /        */
/*  studentByCode) — no parallel implementation, no data assumption    */
/*  beyond what the registration conventions already guarantee.       */
/* ================================================================== */

/** The identity form that resolved a charge to its backing installment. */
export type ChargeInstallmentResolutionForm =
  | "installment-pk" // form A — the bulk-import identity
  | "reg-identity"; // form B — the registration business identity

export interface ChargeInstallmentResolution {
  readonly installment: Installment;
  readonly form: ChargeInstallmentResolutionForm;
}

/**
 * The registration identity token: `reg-<token>[-transport]-t<n>` or
 * `reg-<token>-fi`. The token is the student CODE or UUID (the 0103
 * substitution keeps either form); `-transport-` marks the transport
 * category; `t<n>` the wave; `fi` the registration fee (wave 0).
 */
const REG_IDENTITY_RE = /^reg-(?<token>.+?)-(?:transport-)?(?<wave>fi|t[0-9]+)$/;

/**
 * Resolve a `source_type='installment'` charge to its backing installment
 * through the canonical identity forms, in order. Returns null when NO
 * form resolves — the genuine dangling-reference class (the finding the
 * owner demands preserved). PURE: reads the indexes only, mutates nothing.
 */
function resolveChargeInstallment(
  ctx: AuditContext,
  e: LedgerEntry,
): ChargeInstallmentResolution | null {
  // Form A — the direct PK (the bulk-import identity).
  const byPk = ctx.installmentById.get(e.sourceId);
  if (byPk) return { installment: byPk, form: "installment-pk" };

  // Form B — the registration business identity.
  const m = REG_IDENTITY_RE.exec(e.sourceId);
  if (!m || !m.groups) return null;
  const waveRaw = m.groups.wave === "fi" ? 0 : Number(m.groups.wave.slice(1));
  if (!Number.isInteger(waveRaw) || waveRaw < 0 || waveRaw > 3) return null;
  const trancheNumber = waveRaw as 0 | 1 | 2 | 3;

  // The SUBJECT: the charge's own studentId (the registration always
  // stamps it), then the token against the students stream by code.
  let studentId = e.studentId;
  if (!studentId) {
    const byCode = ctx.studentByCode.get(m.groups.token);
    if (byCode) studentId = byCode.id;
  }
  if (!studentId) return null;

  // The CATEGORY: the charge's own category is authoritative; when the
  // entry predates per-category stamping, the token's transport marker
  // decides (the registration's two categories are tuition + transport).
  const category =
    e.category ?? (e.sourceId.includes("-transport-") ? "transport" : "tuition");

  const rows = ctx.installmentsByStudent.get(studentId) ?? [];
  // Exact wave match, inside the SAME family (never cross accounts).
  const exact = rows.find(
    (i) =>
      i.category === category &&
      i.trancheNumber === trancheNumber &&
      i.parentId === e.parentId,
  );
  if (exact) return { installment: exact, form: "reg-identity" };

  // Guarded fallback: a student with EXACTLY ONE installment of the
  // charge's category resolves unambiguously even when the wave number
  // drifts (the full-annual « Année complète » row may carry no wave).
  const sameCategory = rows.filter(
    (i) => i.category === category && i.parentId === e.parentId,
  );
  if (sameCategory.length === 1) return { installment: sameCategory[0], form: "reg-identity" };

  return null;
}

/** Finding builder — keeps every construction site uniform. */
function finding(
  category: WebhookFindingCategory,
  severity: WebhookFindingSeverity,
  primaryRecordId: string,
  partial: Omit<WebhookDiagnosticFinding, "id" | "category" | "severity" | "currency">,
): WebhookDiagnosticFinding {
  return {
    id: `${category}:${primaryRecordId}`,
    category,
    severity,
    currency: "DZD",
    ...partial,
  };
}

/* ================================================================== */
/*  Check 1 — Payment ↔ ledger consistency (issue #30 Example D)       */
/*  The persisted ledger entry must describe the SAME transaction as   */
/*  the payment record: amount, status, customer identity, receipt.    */
/* ================================================================== */

function auditPaymentLedgerConsistency(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  const tol = ctx.thresholds.amountToleranceDzd;
  for (const p of ctx.payments) {
    const entries = ctx.ledgerPaymentsBySourceId.get(p.id) ?? [];

    // (a) Partial processing: the event persisted a payment but NO ledger
    //     entry ever landed (the money is recorded twice-removed: visible
    //     in the payments table, invisible to every ledger-derived balance).
    if (entries.length === 0) {
      findings.push(
        finding("confirmed_mismatch", "warning", `pay-no-ledger:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: p.amount,
          recordIds: {
            payment: p.id,
            receiptNumber: p.receiptNumber ?? undefined,
          },
          sourceRefs: [`payments:${p.id}`, `receipt:${p.receiptNumber}`],
          title: "Paiement sans écriture de grand livre",
          explanation:
            `Le paiement ${p.receiptNumber} (${dzd(p.amount)}, statut « ${p.status} ») est enregistré ` +
            `dans la table des paiements mais AUCUNE écriture de grand livre de type « paiement » ne référence ` +
            `sa source (${p.id}). Le montant est donc invisible pour tout solde dérivé du grand livre — ` +
            `un traitement partiel de l'événement (l'écriture financière n'a jamais atterri).`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${p.status} · ${isoDate(p.collectedAt)}`, sourceRef: `payments:${p.id}` },
            { label: "Écritures de grand livre liées (sourceType=payment)", value: "0 trouvée", sourceRef: null },
          ],
          calculation: null,
          suggestedSteps: [
            "Vérifier le journal d'audit de la collecte (payment.create) pour déterminer si l'écriture a échoué après l'encaissement.",
            "Comparer le total des paiements et le total des écritures « paiement » du grand livre pour ce compte.",
            "Si l'écriture manque réellement, régulariser via le flux existant (jamais une insertion directe).",
          ],
        }),
      );
      continue;
    }

    // (b) Duplicate event: one payment source produced MULTIPLE ledger
    //     entries (a replayed webhook delivery / non-idempotent processing).
    if (entries.length > 1) {
      const dups = entries.map((e) => `${e.id} (${dzd(Math.abs(e.amount))})`).join(" · ");
      findings.push(
        finding("duplicate_event", "critical", `pay-multi-ledger:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: entries.reduce((s, e) => s + Math.abs(e.amount), 0),
          recordIds: {
            payment: p.id,
            ledgerEntry: entries[0].id,
            receiptNumber: p.receiptNumber ?? undefined,
          },
          sourceRefs: [`payments:${p.id}`, ...entries.map((e) => `ledger:${e.id}`)],
          title: "Paiement compté plusieurs fois au grand livre",
          explanation:
            `La source de paiement ${p.id} (${p.receiptNumber}) a produit ${entries.length} écritures de grand livre ` +
            `(${dups}) — le même événement financier semble avoir été traité plus d'une fois. ` +
            `Chaque écriture réduit le solde du compte, le cumul suréduit la dette de ${dzd(entries.reduce((s, e) => s + Math.abs(e.amount), 0) - p.amount)}.`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} (montant réel)`, sourceRef: `payments:${p.id}` },
            ...entries.map((e) => ({
              label: `Écriture ${e.id}`,
              value: `${dzd(Math.abs(e.amount))} · ${isoDate(e.at)}`,
              sourceRef: `ledger:${e.id}`,
            })),
          ],
          calculation: `${entries.length} écritures × sources identiques pour 1 paiement — cumul ${dzd(entries.reduce((s, e) => s + Math.abs(e.amount), 0))} ≠ ${dzd(p.amount)}`,
          suggestedSteps: [
            "Identifier les identifiants d'événement dupliqués dans le journal d'audit (le même sourceId traité N fois).",
            "Vérifier si une extourne existe déjà pour les doublons (reversesId) avant toute correction.",
            "Régulariser via le flux d'extourne existant — jamais une suppression directe d'écriture.",
          ],
        }),
      );
      continue; // the mismatch checks below assume exactly one entry
    }

    const entry = entries[0];

    // (c) Amount mismatch: the webhook recorded one amount, the ledger another.
    if (Math.abs(Math.abs(entry.amount) - p.amount) > tol) {
      findings.push(
        finding("confirmed_mismatch", "critical", `pay-amt:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: Math.abs(Math.abs(entry.amount) - p.amount),
          recordIds: {
            payment: p.id,
            ledgerEntry: entry.id,
            receiptNumber: p.receiptNumber ?? undefined,
          },
          sourceRefs: [`payments:${p.id}`, `ledger:${entry.id}`],
          title: "Montant du paiement ≠ montant de l'écriture",
          explanation:
            `Le paiement ${p.receiptNumber} enregistre ${dzd(p.amount)} mais son écriture de grand livre ${entry.id} ` +
            `porte ${dzd(Math.abs(entry.amount))} — l'événement et sa comptabilisation ne décrivent pas la même transaction. ` +
            `Le solde du compte diverge de ${dzd(Math.abs(Math.abs(entry.amount) - p.amount))} du montant réellement encaissé.`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${isoDate(p.collectedAt)}`, sourceRef: `payments:${p.id}` },
            { label: `Écriture ${entry.id}`, value: `${dzd(Math.abs(entry.amount))} · statut ${entry.paymentStatus ?? "—"}`, sourceRef: `ledger:${entry.id}` },
          ],
          calculation: `${dzd(Math.abs(entry.amount))} − ${dzd(p.amount)} = ${dzd(Math.abs(Math.abs(entry.amount) - p.amount))} d'écart`,
          suggestedSteps: [
            "Retrouver la charge utile d'origine de l'événement (journal d'audit payment.create) pour déterminer le montant authentique.",
            "Vérifier le reçu PDF généré — il reflète le montant demandé à l'encaissement.",
            "Régulariser par extourne + nouvelle écriture via le flux existant.",
          ],
        }),
      );
    }

    // (d) Customer identity: the money must land on the payer's account.
    if (entry.parentId !== p.parentId) {
      findings.push(
        finding("confirmed_mismatch", "critical", `pay-parent:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: p.amount,
          recordIds: {
            payment: p.id,
            ledgerEntry: entry.id,
            receiptNumber: p.receiptNumber ?? undefined,
          },
          sourceRefs: [`payments:${p.id}`, `ledger:${entry.id}`],
          title: "Client de l'écriture ≠ client du paiement",
          explanation:
            `Le paiement ${p.receiptNumber} appartient au parent ${p.parentId} ` +
            `(${ctx.displayName(p.parentId) ?? "parent inconnu"}) mais son écriture de grand livre ${entry.id} est portée ` +
            `au compte du parent ${entry.parentId} (${ctx.displayName(entry.parentId) ?? "parent inconnu"}) — ` +
            `l'argent est possiblement imputé au mauvais compte famille (fusion ou ré-affectation mal appliquée).`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `parent ${p.parentId}`, sourceRef: `payments:${p.id}` },
            { label: `Écriture ${entry.id}`, value: `parent ${entry.parentId}`, sourceRef: `ledger:${entry.id}` },
          ],
          calculation: null,
          suggestedSteps: [
            "Vérifier l'historique de fusion/lien des comptes concernés (le parent d'origine a-t-il été fusionné ?).",
            "Contrôler le dossier financier des DEUX parents pour localiser où le solde a dérivé.",
            "Régulariser via le flux d'ajustement existant avec motif documenté.",
          ],
        }),
      );
    }

    // (e) Status coherence: the ledger entry's clearing status must mirror
    //     the payment's lifecycle status.
    if ((entry.paymentStatus ?? null) !== p.status) {
      findings.push(
        finding("confirmed_mismatch", "warning", `pay-status:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: p.amount,
          recordIds: {
            payment: p.id,
            ledgerEntry: entry.id,
            receiptNumber: p.receiptNumber ?? undefined,
          },
          sourceRefs: [`payments:${p.id}`, `ledger:${entry.id}`],
          title: "Statut du paiement ≠ statut de l'écriture",
          explanation:
            `Le paiement ${p.receiptNumber} est « ${p.status} » mais son écriture ${entry.id} porte ` +
            `« ${entry.paymentStatus ?? "aucun statut"} » — le grand livre et la table des paiements ne ` +
            `sont pas d'accord sur l'état de compensation (un chèque compensé côté paiement mais en attente côté grand livre ` +
            `fausse le solde « réglé » du compte).`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `statut ${p.status}`, sourceRef: `payments:${p.id}` },
            { label: `Écriture ${entry.id}`, value: `statut ${entry.paymentStatus ?? "—"}`, sourceRef: `ledger:${entry.id}` },
          ],
          calculation: null,
          suggestedSteps: [
            "Identifier lequel des deux statuts reflète la compensation bancaire réelle.",
            "Vérifier la transition de statut dans le journal d'audit (mark_payment_cleared).",
          ],
        }),
      );
    }

    // (f) Sign convention: a payment entry is a CREDIT (negative amount).
    if (entry.amount > 0) {
      findings.push(
        finding("confirmed_mismatch", "critical", `pay-sign:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: p.amount,
          recordIds: { payment: p.id, ledgerEntry: entry.id },
          sourceRefs: [`ledger:${entry.id}`],
          title: "Écriture de paiement signée au mauvais sens",
          explanation:
            `L'écriture ${entry.id} du paiement ${p.receiptNumber} porte un montant POSITIF ` +
            `(${dzd(entry.amount)}) — or une écriture de paiement est toujours un crédit (montant négatif qui réduit la dette). ` +
            `Cette écriture AUGMENTE la dette du parent au lieu de la réduire.`,
          evidence: [
            { label: `Écriture ${entry.id}`, value: `${dzd(entry.amount)} (positif = débit)`, sourceRef: `ledger:${entry.id}` },
            { label: "Convention du grand livre", value: "paiement = crédit (négatif)", sourceRef: null },
          ],
          calculation: `${dzd(entry.amount)} au lieu de ${dzd(-p.amount)} — la dette est surévaluée de ${dzd(2 * entry.amount)}`,
          suggestedSteps: [
            "Extourner l'écriture erronée via le flux existant et recréer l'écriture au bon signe.",
            "Rechercher d'autres écritures de la même source d'import présentant le défaut.",
          ],
        }),
      );
    }
  }
}

/* ================================================================== */
/*  Check 2 — Date semantics (issue #30 Example A)                     */
/*  A COLLECTED payment (paid/partial) whose collection date lies in   */
/*  the future cannot have happened; if the as-of balance replay       */
/*  excludes such entries, a fully-paid account reports false debt.    */
/*  A SCHEDULED future payment is an INSTALLMENT trait, never a paid   */
/*  payment record — the two must never be conflated.                  */
/* ================================================================== */

function auditDateSemantics(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  const graceMs = ctx.thresholds.futureDateGraceDays * 86_400_000;

  for (const p of ctx.payments) {
    const isCollected = p.status === "paid" || p.status === "partial";
    if (!isCollected) continue; // pending = scheduled/uncleared — not a collected claim
    const collectedMs = Date.parse(p.collectedAt);
    if (!Number.isFinite(collectedMs)) continue;
    if (collectedMs <= ctx.nowMs + graceMs) continue; // not future-dated

    const daysInFuture = Math.max(0, Math.floor((collectedMs - ctx.nowMs) / 86_400_000));
    const cashConflict = p.method === "cash";
    const severity: WebhookFindingSeverity = cashConflict ? "critical" : "warning";

    findings.push(
      finding("date_semantic_conflict", severity, `pay-future:${p.id}`, {
        parentId: p.parentId,
        parentName: ctx.displayName(p.parentId),
        amount: p.amount,
        recordIds: { payment: p.id, receiptNumber: p.receiptNumber ?? undefined },
        sourceRefs: [`payments:${p.id}`, `receipt:${p.receiptNumber}`, `collectedAt:${p.collectedAt}`],
        title: cashConflict
          ? "Paiement en espèces « payé » daté dans le futur"
          : "Paiement réglé daté dans le futur",
        explanation:
          `Le paiement ${p.receiptNumber} est marqué « ${p.status} » (${cashConflict ? "espèces encaissées" : "fonds réglés"}) ` +
          `mais sa date de collecte est ${isoDate(p.collectedAt)} — dans ${daysInFuture} jour(s) par rapport à la date d'audit. ` +
          (cashConflict
            ? `Des espèces ne peuvent pas être encaissées à une date future : la date est très probablement une date de tranche/planning ` +
              `assignée à tort lors d'un import dont la source ne contenait pas de date réelle de paiement. `
            : `Un paiement réglé à une date future est contradictoire ; si la date est planifiée, l'enregistrement devrait être une ` +
              `échéance (statut en attente), pas un paiement réglé. `) +
          `Si le solde « à la date d'aujourd'hui » exclut les écritures datées à l'avenir, ce paiement disparaît du solde ` +
          `alors que le relevé importé le marque payé — le compte peut apparaître devoir de l'argent à tort.`,
        evidence: [
          { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${p.method} · statut ${p.status}`, sourceRef: `payments:${p.id}` },
          { label: "Date de collecte enregistrée", value: isoDate(p.collectedAt), sourceRef: `payments:${p.id}#collectedAt` },
          { label: "Date d'audit (aujourd'hui)", value: new Date(ctx.nowMs).toISOString().slice(0, 10), sourceRef: null },
          { label: "Écart", value: `+${daysInFuture} jour(s) dans le futur`, sourceRef: null },
        ],
        calculation: `${isoDate(p.collectedAt)} − ${new Date(ctx.nowMs).toISOString().slice(0, 10)} = ${daysInFuture} jour(s) dans le futur`,
        suggestedSteps: [
          "Vérifier la source d'import de la ligne (la feuille ETAT ne contient pas de dates de paiement réelles — les dates de tranches ont pu être utilisées comme convention).",
          "Distinguer un VRAI paiement planifié (une échéance future non payée) d'un paiement historique mal daté.",
          "Ne PAS réécrire la date automatiquement : la correction doit passer par le flux d'import/remédiation revu, avec trace d'audit.",
        ],
      }),
    );
  }

  // Installments: a "paid" tranche whose paidDate lies in the future.
  for (const i of ctx.installments) {
    if (i.status !== "paid" || !i.paidDate) continue;
    const paidMs = Date.parse(i.paidDate);
    if (!Number.isFinite(paidMs) || paidMs <= ctx.nowMs + graceMs) continue;
    const daysInFuture = Math.max(0, Math.floor((paidMs - ctx.nowMs) / 86_400_000));
    findings.push(
      finding("date_semantic_conflict", "warning", `inst-future:${i.id}`, {
        parentId: i.parentId,
        parentName: ctx.displayName(i.parentId),
        amount: i.amountPaid,
        recordIds: { installment: i.id },
        sourceRefs: [`installments:${i.id}`, `paidDate:${i.paidDate}`],
        title: "Tranche « payée » avec date de paiement future",
        explanation:
          `La tranche « ${i.label} » (${dzd(i.amountDue)}) est marquée payée mais sa date de paiement est ` +
          `${isoDate(i.paidDate)} — dans ${daysInFuture} jour(s). Le statut et la date ne sont pas cohérents ensemble.`,
        evidence: [
          { label: `Tranche ${i.label}`, value: `${dzd(i.amountDue)} · statut ${i.status}`, sourceRef: `installments:${i.id}` },
          { label: "Date de paiement", value: isoDate(i.paidDate), sourceRef: `installments:${i.id}#paidDate` },
        ],
        calculation: null,
        suggestedSteps: [
          "Vérifier si le paiement lié porte aussi une date future (le défaut date-semantics de la même classe).",
          "Confirmer la date réelle d'encaissement auprès du relevé source.",
        ],
      }),
    );
  }
}

/* ================================================================== */
/*  Check 3 — Duplicates (issue #30 Example D: replayed deliveries)    */
/* ================================================================== */

function auditDuplicates(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  // (a) Receipt numbers are server-allocated unique — two payments sharing
  //     one receipt number is a replayed/merged event signature.
  const byReceipt = new Map<string, Payment[]>();
  for (const p of ctx.payments) {
    if (!p.receiptNumber) continue;
    const list = byReceipt.get(p.receiptNumber) ?? [];
    list.push(p);
    byReceipt.set(p.receiptNumber, list);
  }
  for (const [receipt, group] of byReceipt) {
    if (group.length < 2) continue;
    const total = group.reduce((s, p) => s + p.amount, 0);
    findings.push(
      finding("duplicate_event", "critical", `dup-receipt:${receipt}`, {
        parentId: group[0].parentId,
        parentName: ctx.displayName(group[0].parentId),
        amount: total,
        recordIds: { payment: group[0].id, receiptNumber: receipt },
        sourceRefs: group.map((p) => `payments:${p.id}`),
        title: `Reçu ${receipt} attribué à ${group.length} paiements`,
        explanation:
          `Le numéro de reçu ${receipt} identifie ${group.length} paiements distincts ` +
          `(${group.map((p) => `${p.id} · ${dzd(p.amount)} · ${isoDate(p.collectedAt)}`).join(" | ")}) — ` +
          `le même événement semble avoir été livré/traité plus d'une fois. Le cumul ${dzd(total)} ` +
          `réduit la dette du compte alors qu'un seul des paiements correspond à un encaissement réel.`,
        evidence: group.map((p) => ({
          label: `Paiement ${p.id}`,
          value: `${dzd(p.amount)} · ${p.method} · ${isoDate(p.collectedAt)} · ${p.status}`,
          sourceRef: `payments:${p.id}`,
        })),
        calculation: `${group.length} paiements × même reçu ${receipt} — cumul ${dzd(total)}`,
        suggestedSteps: [
          "Comparer les horodatages de création (createdAt) — un rejeu se voit à quelques secondes/millisecondes d'écart.",
          "Vérifier le journal d'audit pour le même identifiant d'événement traité plusieurs fois.",
          "Annuler le doublon par le flux existant (extourne/annulation) — jamais une suppression de ligne.",
        ],
      }),
    );
  }

  // (b) Exact business-tuple CANDIDATE groups (same parent, amount, method,
  //     date, status) — the tuple remains the candidate generator, but the
  //     duplicate JUDGMENT now sees the SUBJECT dimension (T-528 / AUDIT-508):
  //     siblings in one family legitimately pay IDENTICAL per-grade amounts
  //     on the same day (each payment a DIFFERENT student's obligation, each
  //     with its own receipt — identical pricing makes the non-unique
  //     attributes collide by design), while a REPEATED subject (same
  //     student, or an unverifiable null one) with distinct receipts is the
  //     classic replayed-delivery signature. Skips groups already caught
  //     by (a).
  const byTuple = new Map<string, Payment[]>();
  for (const p of ctx.payments) {
    const key = `${p.parentId}|${p.amount}|${p.method}|${p.collectedAt}|${p.status}`;
    const list = byTuple.get(key) ?? [];
    list.push(p);
    byTuple.set(key, list);
  }
  for (const group of byTuple.values()) {
    if (group.length < 2) continue;
    const receipts = new Set(group.map((p) => p.receiptNumber));
    if (receipts.size === 1) continue; // already reported by (a)

    // Partition by SUBJECT — the student whose obligation the payment
    // settles. Null studentIds are UNVERIFIABLE subjects: they form their
    // own bucket and never count as sibling evidence.
    const NULL_SUBJECT = "\u0000unverified-subject";
    const bySubject = new Map<string, Payment[]>();
    for (const p of group) {
      const subject = p.studentId ?? NULL_SUBJECT;
      const list = bySubject.get(subject) ?? [];
      list.push(p);
      bySubject.set(subject, list);
    }

    // THE SIBLING CLASS (T-528): every member on a DISTINCT, KNOWN student
    // — the legitimate pattern (identical per-grade pricing, one collection
    // day, distinct receipts). Reconciled, with the explanation of WHY
    // identical tuples are expected — never a duplicate warning.
    const allDistinctKnownStudents =
      group.every((p) => p.studentId !== null) && bySubject.size === group.length;
    if (allDistinctKnownStudents) {
      const sample = group[0];
      const studentNames = group.map((p) => {
        const s = p.studentId ? ctx.studentById.get(p.studentId) : undefined;
        return s ? `${s.firstName} ${s.lastName}` : p.studentId ?? "?";
      });
      const total = group.reduce((s, p) => s + p.amount, 0);
      findings.push(
        finding("reconciled", "ok", `dup-siblings:${sample.id}`, {
          parentId: sample.parentId,
          parentName: ctx.displayName(sample.parentId),
          amount: total,
          recordIds: { payment: sample.id, receiptNumber: sample.receiptNumber ?? undefined },
          sourceRefs: group.map((p) => `payments:${p.id}`),
          title: "Paiements identiques légitimes — élèves distincts de la même fratrie",
          explanation:
            `${group.length} paiements du même compte portent le même profil (${dzd(sample.amount)}, ` +
            `${sample.method}, ${isoDate(sample.collectedAt)}, statut « ${sample.status} ») — mais chacun règle ` +
            `l'obligation d'un ÉLÈVE DIFFÉRENT : ${studentNames.join(" · ")}, chacun avec son propre reçu ` +
            `(${group.map((p) => p.receiptNumber).join(" · ")}). Des montants identiques entre frères et sœurs ` +
            `sont attendus (tarification identique par niveau) — ce ne sont pas des événements rejoués.`,
          evidence: group.map((p) => {
            const s = p.studentId ? ctx.studentById.get(p.studentId) : undefined;
            return {
              label: `Paiement ${p.receiptNumber}`,
              value: `${dzd(p.amount)} · ${isoDate(p.collectedAt)} · élève ${s ? `${s.firstName} ${s.lastName}` : p.studentId ?? "?"}`,
              sourceRef: `payments:${p.id}`,
            };
          }),
          calculation: `${group.length} paiements × ${dzd(sample.amount)} = ${dzd(total)} — ${group.length} élèves distincts, ${group.length} reçus distincts`,
          suggestedSteps: [],
        }),
      );
      continue;
    }

    // THE GENUINE CLASS: flag only the SAME-SUBJECT subsets — a repeated
    // student (the same child's obligation paid twice) or repeated
    // unverifiable subjects. Distinct-student members of a mixed group are
    // NOT implicated by the other members' replay.
    for (const [subject, subset] of bySubject) {
      if (subset.length < 2) continue;
      const subsetReceipts = new Set(subset.map((p) => p.receiptNumber));
      if (subsetReceipts.size === 1) continue; // already reported by (a)
      const total = subset.reduce((s, p) => s + p.amount, 0);
      const sample = subset[0];
      const subjectLabel =
        subject === NULL_SUBJECT
          ? "élève non renseigné (sujet invérifiable)"
          : (() => {
              const s = ctx.studentById.get(subject);
              return s ? `${s.firstName} ${s.lastName} (${s.code})` : subject;
            })();
      findings.push(
        finding("duplicate_event", "warning", `dup-tuple:${sample.id}`, {
          parentId: sample.parentId,
          parentName: ctx.displayName(sample.parentId),
          amount: total - sample.amount,
          recordIds: { payment: sample.id, receiptNumber: sample.receiptNumber ?? undefined },
          sourceRefs: subset.map((p) => `payments:${p.id}`),
          title: "Paiements identiques répétés pour le même élève (même montant, date, méthode)",
          explanation:
            `${subset.length} paiements du parent ${sample.parentId} portent exactement le même profil : ` +
            `${dzd(sample.amount)}, ${sample.method}, ${isoDate(sample.collectedAt)}, statut « ${sample.status} » ` +
            `— et règlent le même sujet (${subjectLabel}) — la signature d'un événement rejoué ` +
            `(livraison dupliquée traitée deux fois avec des reçus différents).`,
          evidence: subset.map((p) => ({
            label: `Paiement ${p.id}`,
            value: `${p.receiptNumber} · ${dzd(p.amount)} · ${isoDate(p.collectedAt)} · élève ${p.studentId ?? "non renseigné"}`,
            sourceRef: `payments:${p.id}`,
          })),
          calculation: `Impact potentiel : ${dzd(total - sample.amount)} comptés en trop`,
          possibleCauses: [
            "Un événement source livré/deux fois traité (rejeu webhook/import avec des reçus distincts).",
            "Un double encaissement réel au comptoir (deux reçus émis pour le même élève, même jour, même montant).",
            "Un sujet non renseigné (élève absent) rend la comparaison impossible — à rattacher avant tout jugement.",
          ],
          suggestedSteps: [
            "Vérifier dans le journal d'audit si les deux paiements proviennent du même événement source.",
            "Confirmer avec le relevé bancaire/caisse qu'un seul encaissement a eu lieu.",
            "Régulariser le doublon via le flux d'annulation existant.",
          ],
        }),
      );
    }
  }
}

/* ================================================================== */
/*  Check 4 — Orphan ledger payment entries (the inverse direction)    */
/* ================================================================== */

function auditOrphanLedgerEntries(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  for (const e of ctx.ledgerEntries) {
    if (e.type !== "payment" || e.sourceType !== "payment") continue;
    if (ctx.paymentById.has(e.sourceId)) continue;
    findings.push(
      finding("confirmed_mismatch", "warning", `orphan-ledger:${e.id}`, {
        parentId: e.parentId,
        parentName: ctx.displayName(e.parentId),
        amount: Math.abs(e.amount),
        recordIds: { ledgerEntry: e.id },
        sourceRefs: [`ledger:${e.id}`, `source:payment/${e.sourceId}`],
        title: "Écriture de paiement sans paiement source",
        explanation:
          `L'écriture ${e.id} (${dzd(Math.abs(e.amount))}) référence la source payment/${e.sourceId} ` +
          `qui n'existe pas dans la table des paiements — soit le paiement a été supprimé après comptabilisation, ` +
          `soit l'écriture a été créée avec un identifiant de source invalide (traitement partiel d'un événement).`,
        evidence: [
          { label: `Écriture ${e.id}`, value: `${dzd(Math.abs(e.amount))} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
          { label: "Source référencée", value: `payment/${e.sourceId} — introuvable`, sourceRef: null },
        ],
        calculation: null,
        suggestedSteps: [
          "Rechercher l'identifiant source dans le journal d'audit et la corbeille éventuelle.",
          "Vérifier si une extourne existe déjà pour cette écriture.",
        ],
      }),
    );
  }
}

/* ================================================================== */
/*  Check 5 — Charge traceability & business justification (Example C) */
/*  Every charge must resolve to a concrete source (an installment row */
/*  for schedule charges, a documented reason for manual/import ones)  */
/*  AND carry a defensible description. A vague label is NOT evidence. */
/* ================================================================== */

function auditChargeJustification(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  for (const e of ctx.ledgerEntries) {
    if (e.type !== "charge") continue;
    const parentName = ctx.displayName(e.parentId);

    // (a) Installment-backed charges — the canonical schedule charges.
    if (e.sourceType === "installment") {
      const resolved = resolveChargeInstallment(ctx, e);
      if (!resolved) {
        // Distinguish MISSING DATA (unverified) from a DANGLING reference
        // (confirmed mismatch): when the installments stream itself is
        // empty/unavailable we cannot conclude; when rows exist but this
        // one is gone through NEITHER canonical identity form (the PK NOR
        // the reg-identity), the source link is broken — the GENUINE
        // missing-installment class (preserved per the owner's contract).
        const sourceAvailable = ctx.installments.length > 0;
        findings.push(
          sourceAvailable
            ? finding("confirmed_mismatch", "critical", `charge-dangling:${e.id}`, {
                parentId: e.parentId,
                parentName,
                amount: e.amount,
                recordIds: { ledgerEntry: e.id },
                sourceRefs: [`ledger:${e.id}`, `source:installment/${e.sourceId}`],
                title: "Facture liée à une échéance introuvable",
                explanation:
                  `L'écriture de facturation ${e.id} (${dzd(e.amount)}) référence l'échéance ${e.sourceId} ` +
                  `qui n'existe ni comme clé d'échéance ni comme identité d'inscription ` +
                  `(reg-…-t<n> : élève/catégorie/tranche introuvables dans le périmètre du compte) — ` +
                  `la charge est orpheline de sa source : le montant reste dû au grand livre sans ` +
                  `qu'aucune échéance concrète ne l'explique.`,
                evidence: [
                  { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
                  { label: "Échéance référencée", value: `${e.sourceId} — introuvable (PK et identité d'inscription)`, sourceRef: null },
                ],
                calculation: null,
                possibleCauses: [
                  "L'échéance source a été supprimée ou fusionnée sans extourne de la charge (vérifier le journal d'audit).",
                  "Une identité d'inscription incomplète ou altérée (élève, catégorie ou tranche ne correspondant plus au périmètre du compte — famille fusionnée, tranche renumérotée).",
                  "Une écriture créée avec un identifiant de source invalide (traitement partiel d'un flux).",
                ],
                suggestedSteps: [
                  "Vérifier l'historique de suppression/fusion des échéances (journal d'audit).",
                  "Si l'échéance a été supprimée sans extourne de la charge, régulariser via le flux existant.",
                ],
              })
            : finding("unverified", "info", `charge-nosrc:${e.id}`, {
                parentId: e.parentId,
                parentName,
                amount: e.amount,
                recordIds: { ledgerEntry: e.id },
                sourceRefs: [`ledger:${e.id}`, `source:installment/${e.sourceId}`],
                title: "Facture à source invérifiable (données non chargées)",
                explanation:
                  `L'écriture de facturation ${e.id} (${dzd(e.amount)}) référence l'échéance ${e.sourceId}, ` +
                  `mais aucune donnée d'échéance n'est disponible dans cet audit — l'existence de la source ` +
                  `ne peut être ni confirmée ni infirmée (non vérifiable, pas frauduleux).`,
                evidence: [
                  { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
                  { label: "Table des échéances", value: "0 ligne chargée", sourceRef: null },
                ],
                calculation: null,
                suggestedSteps: [
                  "Recharger les données financières (l'échéancier n'a pas été semé) et relancer l'audit.",
                ],
              }),
        );
        continue;
      }
      const inst = resolved.installment;
      // amount coherence: the charge must invoice the tranche's amountDue.
      if (Math.abs(e.amount - inst.amountDue) > ctx.thresholds.amountToleranceDzd) {
        findings.push(
          finding("confirmed_mismatch", "critical", `charge-amt:${e.id}`, {
            parentId: e.parentId,
            parentName,
            amount: Math.abs(e.amount - inst.amountDue),
            recordIds: { ledgerEntry: e.id, installment: inst.id },
            sourceRefs: [`ledger:${e.id}`, `installments:${inst.id}`],
            title: "Montant facturé ≠ montant de l'échéance",
            explanation:
              `L'écriture ${e.id} facture ${dzd(e.amount)} mais l'échéance source « ${inst.label} » porte ` +
              `${dzd(inst.amountDue)} — la charge et son support ne décrivent pas le même montant` +
              `${resolved.form === "reg-identity" ? ` (raccordement par l'identité d'inscription ${e.sourceId})` : ""}.`,
            evidence: [
              { label: `Écriture ${e.id}`, value: dzd(e.amount), sourceRef: `ledger:${e.id}` },
              { label: `Échéance ${inst.label}`, value: `${dzd(inst.amountDue)} · ${isoDate(inst.dueDate)}`, sourceRef: `installments:${inst.id}` },
            ],
            calculation: `${dzd(e.amount)} − ${dzd(inst.amountDue)} = ${dzd(e.amount - inst.amountDue)} d'écart`,
            suggestedSteps: [
              "Identifier la charge utile d'origine de l'écriture (import ou RPC) pour déterminer le montant authentique.",
              "Régulariser via le flux d'extourne + nouvelle écriture.",
            ],
          }),
        );
        continue;
      }
      // T-528 (AUDIT-507): a REGISTRATION-IDENTITY charge that resolves and
      // agrees is POSITIVELY accounted — this is exactly the charge class
      // the PK-only lookup used to manufacture false « échéance introuvable »
      // CRITICALs from (every legitimate charge on a newly registered
      // account). The reconciled finding states WHICH identity form resolved
      // the link, so the owner sees why the charge is clean. Form-A (PK)
      // charges stay silent as before — the import class's counts remain
      // byte-stable.
      if (resolved.form === "reg-identity") {
        const student = inst.studentId ? ctx.studentById.get(inst.studentId) : undefined;
        findings.push(
          finding("reconciled", "ok", `charge-reg-resolved:${e.id}`, {
            parentId: e.parentId,
            parentName,
            amount: e.amount,
            recordIds: { ledgerEntry: e.id, installment: inst.id },
            sourceRefs: [`ledger:${e.id}`, `installments:${inst.id}`, `source:installment/${e.sourceId}`],
            title: "Facture d'inscription raccordée à son échéancier",
            explanation:
              `L'écriture de facturation ${e.id} (${dzd(e.amount)}) porte l'identité d'inscription ` +
              `${e.sourceId} : elle est raccordée à l'échéance « ${inst.label} » de ` +
              `${student ? `${student.firstName} ${student.lastName} (${student.code})` : `l'élève ${inst.studentId ?? "?"}`} ` +
              `— même famille, même catégorie (${inst.category}), montant conforme (${dzd(e.amount)} = ${dzd(inst.amountDue)}). ` +
              `Les écritures d'inscription portent une identité métier (reg-…-t<n>) distincte de la clé de l'échéance : ` +
              `le raccordement se fait par élève, catégorie et tranche, jamais par identifiant brut.`,
            evidence: [
              { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
              { label: "Identité d'inscription (source)", value: e.sourceId, sourceRef: `ledger:${e.id}#sourceId` },
              { label: `Échéance « ${inst.label} »`, value: `${dzd(inst.amountDue)} · statut ${inst.status} · tranche ${inst.trancheNumber ?? "—"}`, sourceRef: `installments:${inst.id}` },
              ...(student
                ? [{ label: "Élève", value: `${student.firstName} ${student.lastName} (${student.code})`, sourceRef: `student:${student.id}` }]
                : []),
            ],
            calculation: `${dzd(e.amount)} = ${dzd(inst.amountDue)} — montants conformes`,
            suggestedSteps: [],
          }),
        );
      }
      continue; // installment-backed charges pass the justification gate
    }

    // (b) Non-installment charges (bulk_import / manual_entry / other):
    //     the description + metadata must establish WHAT service or price
    //     the money answers to. A generic label alone is not enough.
    const metadataKeys = Object.keys(e.metadata ?? {});
    const hasTraceMetadata =
      metadataKeys.some((k) => /student|tranche|import|source|field|row|sheet|raison|reason|motif/i.test(k)) &&
      metadataKeys.length > 0;
    const specificDescription = !isGenericFinancialDescription(e.description);
    if (specificDescription || hasTraceMetadata) {
      findings.push(
        finding("reconciled", "ok", `charge-justified:${e.id}`, {
          parentId: e.parentId,
          parentName,
          amount: e.amount,
          recordIds: { ledgerEntry: e.id },
          sourceRefs: [`ledger:${e.id}`, `source:${e.sourceType}/${e.sourceId}`],
          title: "Facture hors échéancier tracée",
          explanation:
            `L'écriture ${e.id} (${dzd(e.amount)}, source ${e.sourceType}/${e.sourceId}) porte une justification ` +
            `lisible (« ${e.description} »${metadataKeys.length ? ` · métadonnées : ${metadataKeys.join(", ")}` : ""}) — ` +
            `le montant est rattaché à un motif concret, restant à recouper avec la matrice de prix si applicable.`,
          evidence: [
            { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
            { label: "Description", value: e.description, sourceRef: `ledger:${e.id}#description` },
          ],
          calculation: null,
          suggestedSteps: [],
        }),
      );
    } else {
      findings.push(
        finding("unjustified_amount", "warning", `charge-unjustified:${e.id}`, {
          parentId: e.parentId,
          parentName,
          amount: e.amount,
          recordIds: { ledgerEntry: e.id },
          sourceRefs: [`ledger:${e.id}`, `source:${e.sourceType}/${e.sourceId}`],
          title: "Montant facturé sans service ni base de prix identifiable",
          explanation:
            `L'écriture de facturation ${e.id} (${dzd(e.amount)}) ne peut être rattachée à aucun élément concret : ` +
            `elle n'est liée à aucune échéance (source ${e.sourceType}/${e.sourceId}), sa description ` +
            `(« ${e.description || "vide"} ») est générique, et aucune métadonnée n'identifie un service, un élève, ` +
            `une ligne d'import ou un prix convenu. Aucune preuve d'un service réel, d'une inscription, d'un devis ou ` +
            `d'un ajustement documenté ne justifie ce montant — il est signalé pour examen, SANS être qualifié de frauduleux.`,
          evidence: [
            { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
            { label: "Description enregistrée", value: `« ${e.description || "(vide)"} » — générique`, sourceRef: `ledger:${e.id}#description` },
            { label: "Échéance liée", value: "aucune (source hors échéancier)", sourceRef: null },
            { label: "Métadonnées de traçabilité", value: metadataKeys.length ? metadataKeys.join(", ") : "aucune", sourceRef: null },
          ],
          calculation: null,
          suggestedSteps: [
            "Retrouver l'origine de l'écriture dans le journal d'audit (acteur, date, source).",
            "Vérifier si une ligne d'import (feuille/rangée du classeur source) correspond à ce montant.",
            "Si un service réel existe, documenter le motif via le flux d'ajustement existant ; sinon régulariser.",
          ],
        }),
      );
    }
  }
}

/* ================================================================== */
/*  Check 6 — Adjustment / refund / credit justification               */
/*  (adjustments: documented reason = evidence; blank = unjustified)   */
/* ================================================================== */

function auditAdjustmentsAndRefunds(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  for (const e of ctx.ledgerEntries) {
    if (e.type !== "adjustment" && e.type !== "refund") continue;
    const parentName = ctx.displayName(e.parentId);
    const specific = !isGenericFinancialDescription(e.description);
    // parent_credit adjustments are the canonical overpayment holding
    // convention (ADR-010) — their category IS their justification.
    const isParentCredit = e.category === "parent_credit";
    if (specific || isParentCredit) {
      findings.push(
        finding("reconciled", "ok", `adj-justified:${e.id}`, {
          parentId: e.parentId,
          parentName,
          amount: Math.abs(e.amount),
          recordIds: { ledgerEntry: e.id },
          sourceRefs: [`ledger:${e.id}`, `source:${e.sourceType}/${e.sourceId}`],
          title: e.type === "refund" ? "Remboursement tracé" : "Ajustement tracé",
          explanation:
            `L'écriture ${e.type === "refund" ? "de remboursement" : "d'ajustement"} ${e.id} ` +
            `(${dzd(Math.abs(e.amount))}) porte une justification ${isParentCredit ? "canonique (crédit parent — convention ADR-010)" : "lisible"} : ` +
            `« ${e.description} » — le mouvement est rattaché à un motif documenté.`,
          evidence: [
            { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
            { label: "Motif", value: e.description, sourceRef: `ledger:${e.id}#description` },
          ],
          calculation: null,
          suggestedSteps: [],
        }),
      );
    } else {
      findings.push(
        finding("unjustified_amount", "warning", `adj-unjustified:${e.id}`, {
          parentId: e.parentId,
          parentName,
          amount: Math.abs(e.amount),
          recordIds: { ledgerEntry: e.id },
          sourceRefs: [`ledger:${e.id}`, `source:${e.sourceType}/${e.sourceId}`],
          title: e.type === "refund" ? "Remboursement sans motif exploitable" : "Ajustement sans motif exploitable",
          explanation:
            `L'écriture ${e.type === "refund" ? "de remboursement" : "d'ajustement"} ${e.id} (${dzd(Math.abs(e.amount))}) ` +
            `porte une description générique (« ${e.description || "vide"} ») qui n'établit pas la légitimité du mouvement : ` +
            `ni remise documentée, ni majoration motivée, ni référence à un événement. ` +
            `Le montant manque d'une base défendable — à examiner, pas automatiquement frauduleux.`,
          evidence: [
            { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
            { label: "Motif enregistré", value: `« ${e.description || "(vide)"} » — générique`, sourceRef: `ledger:${e.id}#description` },
          ],
          calculation: null,
          suggestedSteps: [
            "Retrouver l'opérateur et la date dans le journal d'audit pour demander le motif.",
            "Si un motif légitime existe (remise convenue, correction), le documenter via le flux existant.",
          ],
        }),
      );
    }
  }
}

/* ================================================================== */
/*  Configured-price resolution (T-529 / AUDIT-510) — the CONFIG        */
/*  preferred, the T-425 official matrix the fallback                  */
/* ================================================================== */

/**
 * The tuition schedule for a grade — the ACTIVE config's grid preferred
 * (the owner's mandate: "the prices defined in the application's
 * configuration"), the T-425 official matrix the fallback when no config
 * was supplied. PURE.
 */
function tuitionScheduleFor(
  ctx: AuditContext,
  gradeLevel: GradeLevel,
): RealTuitionSchedule | undefined {
  const configured = ctx.pricingConfig?.tuitionByGradeLevel?.[gradeLevel];
  if (
    configured &&
    Number.isFinite(configured.annualAmount) &&
    Array.isArray(configured.installments) &&
    configured.installments.length === 3
  ) {
    return {
      scolarite: configured.annualAmount,
      v2: configured.installments[0],
      tranche3: configured.installments[1],
      tranche4: configured.installments[2],
    };
  }
  return REAL_TUITION_BY_GRADE[gradeLevel];
}

/**
 * The per-grade registration fee — the config's `registrationFeeByGrade`
 * preferred, the T-425 matrix (`realFiForGrade`) the fallback. PURE.
 */
function registrationFeeFor(ctx: AuditContext, gradeLevel: GradeLevel): number {
  const configured = ctx.pricingConfig?.registrationFeeByGrade?.[gradeLevel];
  if (configured != null && Number.isFinite(configured) && configured > 0) return configured;
  return realFiForGrade(gradeLevel, false);
}

/* ================================================================== */
/*  Check 7 — Price basis & outlier review (issue #30 Example B)       */
/*  The imported tuition total is compared against the applicable     */
/*  price-matrix schedule (T-425's official model). A material         */
/*  deviation is an OUTLIER REQUIRING REVIEW — never auto-corrected,   */
/*  never "fraudulent" — and the concentration of the delta into the   */
/*  final tranche is surfaced explicitly. Documented negotiated        */
/*  schedules (customScheduleNote / isCustomSchedule) are NOT flagged  */
/*  as invalid — they are the legitimate-exception class.             */
/* ================================================================== */

function auditPriceBasis(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  const tol = ctx.thresholds.amountToleranceDzd;
  const multiplier = ctx.thresholds.quoteOutlierMultiplier;

  for (const [studentId, rows] of ctx.installmentsByStudent) {
    const student = ctx.studentById.get(studentId);
    const parentName = ctx.displayName(rows[0]?.parentId ?? null);
    const tuitionRows = rows.filter((i) => i.category === "tuition");
    if (tuitionRows.length === 0) continue;

    const waveRows = tuitionRows.filter(
      (i): i is Installment & { trancheNumber: 1 | 2 | 3 } =>
        i.trancheNumber === 1 || i.trancheNumber === 2 || i.trancheNumber === 3,
    );
    const fiRows = tuitionRows.filter((i) => i.trancheNumber === 0);

    // ── Expected schedule from the price matrix ─────────────────────
    if (!student) {
      findings.push(
        finding("unverified", "info", `price-nostudent:${studentId}`, {
          parentId: rows[0]?.parentId ?? null,
          parentName,
          amount: waveRows.reduce((s, i) => s + i.amountDue, 0),
          recordIds: { installment: waveRows[0]?.id },
          sourceRefs: [`student:${studentId}`, ...waveRows.map((i) => `installments:${i.id}`)],
          title: "Base de prix invérifiable (élève introuvable)",
          explanation:
            `${waveRows.length} échéance(s) de scolarité référencent l'élève ${studentId} qui n'existe pas dans ` +
            `les données chargées — la matrice de prix applicable ne peut être déterminée, la conformité du montant ` +
            `ne peut être ni confirmée ni infirmée (non vérifiable).`,
          evidence: [
            { label: "Élève référencé", value: `${studentId} — introuvable`, sourceRef: `student:${studentId}` },
            { label: "Total importé (tranches)", value: dzd(waveRows.reduce((s, i) => s + i.amountDue, 0)), sourceRef: null },
          ],
          calculation: null,
          suggestedSteps: [
            "Vérifier la fusion/suppression de l'élève et recharger les données.",
          ],
        }),
      );
      continue;
    }

    const schedule = tuitionScheduleFor(ctx, student.gradeLevel);
    if (!schedule) {
      findings.push(
        finding("unverified", "info", `price-nograde:${studentId}`, {
          parentId: student.parentId,
          parentName: ctx.displayName(student.parentId),
          amount: waveRows.reduce((s, i) => s + i.amountDue, 0),
          recordIds: { installment: waveRows[0]?.id },
          sourceRefs: [`student:${studentId}`],
          title: "Base de prix invérifiable (niveau hors matrice)",
          explanation:
            `L'élève ${studentId} porte le niveau « ${student.gradeLevel} » qui n'a pas d'entrée dans la matrice ` +
            `de prix officielle — aucune base de comparaison disponible (non vérifiable, pas une anomalie).`,
          evidence: [
            { label: "Niveau de l'élève", value: student.gradeLevel, sourceRef: `student:${studentId}#gradeLevel` },
            { label: "Total importé (tranches)", value: dzd(waveRows.reduce((s, i) => s + i.amountDue, 0)), sourceRef: null },
          ],
          calculation: null,
          suggestedSteps: [
            "Compléter la matrice de prix pour ce niveau (flux de configuration existant) puis relancer l'audit.",
          ],
        }),
      );
      continue;
    }

    const expectedAnnual = schedule.scolarite; // v2 + tranche3 + tranche4 === scolarite (the official 40/30/30)
    const importedAnnual = waveRows.reduce((s, i) => s + i.amountDue, 0);

    // Documented negotiated schedule — the legitimate-exception class
    // (issue #30 scenario 8: a documented negotiated price must NOT be
    // automatically classified as invalid).
    const documentedNote = tuitionRows.find(
      (i) => (i.customScheduleNote && i.customScheduleNote.trim().length > 0) || i.isCustomSchedule || i.customSchedule,
    )?.customScheduleNote;
    const isDocumented =
      tuitionRows.some((i) => i.isCustomSchedule || i.customSchedule) ||
      (documentedNote !== undefined && documentedNote !== null);

    // FI (tranche 0) rows: the registration fee per grade.
    const fiImported = fiRows.reduce((s, i) => s + i.amountDue, 0);
    const fiExpected = registrationFeeFor(ctx, student.gradeLevel);
    if (fiRows.length > 0 && Math.abs(fiImported - fiExpected) > Math.max(tol, fiExpected * multiplier)) {
      findings.push(
        finding("outlier_review", "warning", `price-fi:${studentId}`, {
          parentId: student.parentId,
          parentName: ctx.displayName(student.parentId),
          amount: fiImported - fiExpected,
          recordIds: { installment: fiRows[0].id },
          sourceRefs: fiRows.map((i) => `installments:${i.id}`),
          title: "Frais d'inscription en écart avec la matrice",
          explanation:
            `Le total FI importé pour l'élève ${studentId} est ${dzd(fiImported)} alors que la matrice officielle ` +
            `prévoit ${dzd(fiExpected)} pour le niveau ${student.gradeLevel} — un écart de ${dzd(fiImported - fiExpected)} ` +
            `à examiner (le FI est un tarif par niveau, hors remises de scolarité).`,
          evidence: [
            { label: "Total FI importé", value: dzd(fiImported), sourceRef: fiRows.map((i) => `installments:${i.id}`).join(", ") },
            { label: "FI attendu (matrice)", value: dzd(fiExpected), sourceRef: `price-matrix:${student.gradeLevel}` },
          ],
          calculation: `${dzd(fiImported)} − ${dzd(fiExpected)} = ${dzd(fiImported - fiExpected)}`,
          suggestedSteps: [
            "Vérifier la ligne source du classeur (référence de cellule/rangée d'import si disponible).",
            "Confirmer auprès de la direction si un FI négocié s'applique ; sinon corriger via le flux d'import.",
          ],
        }),
      );
    }

    if (isDocumented) {
      findings.push(
        finding("reconciled", "ok", `price-documented:${studentId}`, {
          parentId: student.parentId,
          parentName: ctx.displayName(student.parentId),
          amount: importedAnnual,
          recordIds: { installment: waveRows[0]?.id },
          sourceRefs: [`student:${studentId}`, ...waveRows.map((i) => `installments:${i.id}`)],
          title: "Échéancier négocié documenté",
          explanation:
            `Le total de scolarité importé pour l'élève ${studentId} (${dzd(importedAnnual)} vs ${dzd(expectedAnnual)} ` +
            `attendus) s'appuie sur un échéancier personnalisé explicitement documenté ` +
            `(« ${documentedNote || "échéancier personnalisé"} ») — une exception négociée légitime, pas une anomalie.`,
          evidence: [
            { label: "Total importé (tranches)", value: dzd(importedAnnual), sourceRef: null },
            { label: "Attendu (matrice)", value: dzd(expectedAnnual), sourceRef: `price-matrix:${student.gradeLevel}` },
            { label: "Note d'échéancier", value: documentedNote || "échéancier personnalisé", sourceRef: null },
          ],
          calculation: `${dzd(importedAnnual)} vs ${dzd(expectedAnnual)} — écart documenté : ${dzd(importedAnnual - expectedAnnual)}`,
          suggestedSteps: [],
        }),
      );
      continue;
    }

    if (importedAnnual > expectedAnnual * multiplier + tol) {
      // The outlier case — WITH the silent-delta-concentration analysis.
      const delta = importedAnnual - expectedAnnual;
      const lastWave = waveRows.reduce<(Installment & { trancheNumber: 1 | 2 | 3 }) | null>(
        (acc, i) => (acc === null || (i.trancheNumber ?? 0) > (acc.trancheNumber ?? 0) ? i : acc),
        null,
      );
      const expectedLast = schedule.tranche4; // the v3 sticker (≈30%)
      let concentrationNote = "";
      let lastTrancheAbsorbs = false;
      if (lastWave) {
        const absorbed = lastWave.amountDue - expectedLast;
        lastTrancheAbsorbs = Math.abs(absorbed - delta) <= Math.max(tol * 2, expectedLast * 0.1);
        const share = importedAnnual > 0 ? lastWave.amountDue / importedAnnual : 0;
        if (share > ctx.thresholds.trancheConcentrationRatio || lastTrancheAbsorbs) {
          concentrationNote =
            ` Le delta est absorbé par la dernière tranche : « ${lastWave.label} » porte ${dzd(lastWave.amountDue)} ` +
            `(attendu ${dzd(expectedLast)}), soit ${Math.round(share * 100)} % du total annuel — la règle de ` +
            `rapprochement a silencieusement concentré l'écart dans une seule tranche au lieu de le signaler.`;
        }
      }
      findings.push(
        finding("outlier_review", "warning", `price-outlier:${studentId}`, {
          parentId: student.parentId,
          parentName: ctx.displayName(student.parentId),
          amount: delta,
          recordIds: { installment: lastWave?.id ?? waveRows[0]?.id },
          sourceRefs: [`student:${studentId}`, ...waveRows.map((i) => `installments:${i.id}`)],
          title: "Devis annuel importé en écart majeur avec la matrice de prix",
          explanation:
            `Le total de scolarité importé pour l'élève ${studentId} (${dzd(importedAnnual)}) dépasse le multiple ` +
            `configuré (${multiplier}×) du total attendu de la matrice officielle pour le niveau ${student.gradeLevel} ` +
            `(${dzd(expectedAnnual)}) — un écart de ${dzd(delta)}.${concentrationNote} L'écart peut être une faute de ` +
            `frappe dans le classeur source, une référence de cellule erronée, OU un prix négocié exceptionnel légitime — ` +
            `le système ne doit jamais supposer silencieusement qu'il est correct.`,
          evidence: [
            { label: "Total importé (tranches 1-3)", value: dzd(importedAnnual), sourceRef: waveRows.map((i) => `installments:${i.id}`).join(", ") },
            { label: "Total attendu (matrice officielle)", value: dzd(expectedAnnual), sourceRef: `price-matrix:${student.gradeLevel}` },
            { label: "Écart (delta)", value: dzd(delta), sourceRef: null },
            ...(lastWave
              ? [
                  { label: `Dernière tranche « ${lastWave.label} »`, value: `${dzd(lastWave.amountDue)} (attendu ${dzd(expectedLast)})`, sourceRef: `installments:${lastWave.id}` as string | null },
                ]
              : []),
            { label: "Seuil d'écart configurable", value: `${multiplier}× le total attendu`, sourceRef: null },
          ],
          calculation: `${dzd(importedAnnual)} − ${dzd(expectedAnnual)} = ${dzd(delta)} (>${multiplier}× ${dzd(expectedAnnual)})${lastWave ? ` · tranche finale ${dzd(lastWave.amountDue)} vs ${dzd(expectedLast)}` : ""}`,
          suggestedSteps: [
            "Retrouver la ligne/rangée du classeur source à l'origine du montant (référence d'import si disponible).",
            "Vérifier s'il s'agit d'une faute de frappe (un chiffre en trop : 260 000 → 2 600 000) ou d'un prix réellement négocié.",
            "Si le prix est légitime, le documenter comme échéancier personnalisé (note) pour lever le signalement.",
            "Ne JAMAIS corriger automatiquement le devis, la tranche ou le grand livre — la correction passe par le flux d'import revu.",
          ],
        }),
      );
    } else if (Math.abs(importedAnnual - expectedAnnual) <= tol || importedAnnual < expectedAnnual) {
      // Match (or documented-below via remises — under-billing carries its
      // own adjustment entries audited elsewhere).
      findings.push(
        finding("reconciled", "ok", `price-ok:${studentId}`, {
          parentId: student.parentId,
          parentName: ctx.displayName(student.parentId),
          amount: importedAnnual,
          recordIds: { installment: waveRows[0]?.id },
          sourceRefs: [`student:${studentId}`, ...waveRows.map((i) => `installments:${i.id}`)],
          title: "Scolarité conforme à la matrice de prix",
          explanation:
            `Le total de scolarité importé pour l'élève ${studentId} (${dzd(importedAnnual)}) correspond au total ` +
            `attendu de la matrice officielle pour le niveau ${student.gradeLevel} (${dzd(expectedAnnual)}) — ` +
            `la base de prix est établie et le montant tracé.`,
          evidence: [
            { label: "Total importé (tranches 1-3)", value: dzd(importedAnnual), sourceRef: null },
            { label: "Total attendu (matrice)", value: dzd(expectedAnnual), sourceRef: `price-matrix:${student.gradeLevel}` },
          ],
          calculation: `${dzd(importedAnnual)} vs ${dzd(expectedAnnual)} — écart ${dzd(importedAnnual - expectedAnnual)}`,
          suggestedSteps: [],
        }),
      );
    }
    // Between (expected, multiplier×expected): within the configurable
    // tolerance band — no finding (material only above the multiplier).
  }
}

/* ================================================================== */
/*  Check 7bis — Configured-price compliance (T-529 / AUDIT-510, the    */
/*  owner's 173rd-session purpose mandate): every FI-tagged PAYMENT     */
/*  (encaissement) and registration CHARGE compared against the         */
/*  app's CONFIGURED prices — BOTH references: the flat family fee      */
/*  (`registrationFee`, what the registration flow charges) AND the     */
/*  per-grade fee (`registrationFeeByGrade`, what the Excel import      */
/*  charges). A transaction matching ONE reference but violating the    */
/*  other is a DIVERGENCE (outlier_review — the config itself carries   */
/*  two conventions); matching NEITHER is a configured-price VIOLATION  */
/*  (confirmed_mismatch); the config's own flat-vs-per-grade split is   */
/*  surfaced ONCE as the root cause. READ-ONLY: the engine explains     */
/*  and recommends, it never rewrites a financial record.               */
/* ================================================================== */

/** Is this payment an FI (frais d'inscription) encaissement? */
function isFiPayment(p: Payment): boolean {
  if ((p.receiptNumber ?? "").endsWith("-FI")) return true; // the import's deterministic receipt stem
  return /frais\s*d['’]inscription/i.test(p.notes ?? "");
}

/** Is this charge a registration-fee charge? */
function isRegistrationCharge(e: LedgerEntry): boolean {
  if (e.metadata?.type === "registration_fee") return true; // the registration flow's stamp
  return /frais\s*d['’]inscription/i.test(e.description ?? "");
}

/** The payment's provenance, read from the record's own stamps (never guessed). */
function paymentProvenanceFr(p: Payment): string {
  const notes = p.notes ?? "";
  const runId = /import Excel run (\S+)/i.exec(notes)?.[1];
  if (runId) return `import Excel (run ${runId})`;
  if ((p.receiptNumber ?? "").startsWith("IMP-")) return "import Excel (reçu IMP-…)";
  return "saisie via l'application (comptoir/flux manuel)";
}

function auditConfiguredPriceCompliance(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  const cfg = ctx.pricingConfig;
  if (!cfg) {
    // Honest degradation — ONE coverage finding, never silent, never spam.
    findings.push(
      finding("unverified", "info", "price-noconfig:catalog", {
        parentId: null,
        parentName: null,
        amount: null,
        recordIds: {},
        sourceRefs: ["pricing-config:absent"],
        title: "Catalogue de prix non chargé — conformité des montants non vérifiable",
        explanation:
          `La configuration de prix active n'a pas été fournie à l'audit : les encaissements et les factures ` +
          `d'inscription ne peuvent pas être comparés aux tarifs configurés (5 000 DZD plat, tarifs par niveau…) — ` +
          `la conformité des montants au catalogue ne peut être ni confirmée ni infirmée (non vérifiable, pas une anomalie).`,
        evidence: [
          { label: "Catalogue de prix (pricing_configs)", value: "non fourni à l'audit", sourceRef: null },
          { label: "Contrôles concernés", value: "encaissements FI · factures d'inscription · base de prix par niveau", sourceRef: null },
        ],
        calculation: null,
        possibleCauses: [
          "Le flux de configuration n'était pas encore chargé au moment de l'audit (recharger la page Finances puis relancer).",
        ],
        suggestedSteps: [
          "Recharger la configuration de prix (Paramètres → Tarification) puis relancer l'audit.",
        ],
      }),
    );
    return;
  }

  const tol = ctx.thresholds.amountToleranceDzd;
  const flat = cfg.registrationFee;
  const perGrade = cfg.registrationFeeByGrade ?? {};

  // ── (0) The CONFIG-LEVEL tension — the root cause, surfaced ONCE ──────
  const perGradeValues = Object.values(perGrade).filter((v) => Number.isFinite(v) && v > 0);
  const distinctPerGrade = [...new Set(perGradeValues)];
  const flatDiverges = distinctPerGrade.some((v) => Math.abs(v - flat) > tol);
  if (flatDiverges) {
    const lo = Math.min(...distinctPerGrade);
    const hi = Math.max(...distinctPerGrade);
    findings.push(
      finding("outlier_review", "info", "price-config-tension:registration-fee", {
        parentId: null,
        parentName: null,
        amount: null,
        recordIds: {},
        sourceRefs: ["pricing-config:registrationFee", "pricing-config:registrationFeeByGrade"],
        title: "Configuration : deux tarifs d'inscription divergents",
        explanation:
          `Le catalogue de prix configuré porte DEUX conventions pour les frais d'inscription : un tarif familial ` +
          `plat de ${dzd(flat)} (colonne « registrationFee » — c'est celui que facture le flux d'inscription ` +
          `« nouvelle famille ») ET des tarifs par niveau de ${dzd(lo)} à ${dzd(hi)} ` +
          `(« registrationFeeByGrade » — c'est celui que facture l'import Excel, colonne FI du classeur). ` +
          `Un même concept possède donc deux prix configurés divergents : chaque encaissement FI conforme à l'un ` +
          `viole l'autre — les écarts signalés ci-dessous trouvent leur cause racine ICI, dans la configuration, ` +
          `pas nécessairement dans les écritures. Le modèle documente le tarif plat comme HÉRITÉ (CALC-001) : ` +
          `trancher la convention autoritaire est une décision de direction.`,
        evidence: [
          { label: "Tarif plat configuré (familial)", value: dzd(flat), sourceRef: "pricing-config:registrationFee" },
          { label: "Tarifs par niveau configurés", value: `${dzd(lo)} – ${dzd(hi)} (${distinctPerGrade.length} valeurs distinctes)`, sourceRef: "pricing-config:registrationFeeByGrade" },
          { label: "Qui facture quoi", value: "flux d'inscription → tarif plat · import Excel → tarif par niveau", sourceRef: null },
        ],
        calculation: `écart plat vs niveaux : ${dzd(lo - flat)} à ${dzd(hi - flat)}`,
        possibleCauses: [
          `La scission CALC-001 : la colonne plat « registrationFee » est conservée pour le flux d'inscription tandis que la matrice officielle par niveau (T-425) alimente l'import.`,
          "Le tarif plat a pu être abaissé (5 000 DZD) sans aligner la grille par niveau (18 000–30 000) — ou l'inverse.",
        ],
        suggestedSteps: [
          "Trancher la convention autoritaire (direction) : tarif plat familial OU tarif par niveau.",
          "Aligner ensuite la configuration ET les flux d'écriture sur la convention retenue (jamais l'inverse — les écritures passées ne se réécrivent pas sans trace).",
        ],
      }),
    );
  }

  // ── (i) The FI ENCAISSEMENTS vs BOTH configured references ────────────
  for (const p of ctx.payments) {
    if (!isFiPayment(p)) continue;
    const student = p.studentId ? ctx.studentById.get(p.studentId) : undefined;
    const grade = student?.gradeLevel ?? null;
    const gradeFee = grade ? perGrade[grade] : undefined;
    const hasGradeRef = gradeFee != null && Number.isFinite(gradeFee) && gradeFee > 0;

    const matchFlat = Math.abs(p.amount - flat) <= tol;
    const matchGrade = hasGradeRef && Math.abs(p.amount - gradeFee) <= tol;
    const studentLabel = student
      ? `${student.firstName} ${student.lastName} (${student.code})`
      : p.studentId ?? "élève non renseigné";

    if (matchFlat && (!hasGradeRef || matchGrade)) {
      // Agrees with every applicable configured reference.
      findings.push(
        finding("reconciled", "ok", `price-fi-pay-ok:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: p.amount,
          recordIds: { payment: p.id, receiptNumber: p.receiptNumber ?? undefined },
          sourceRefs: [`payments:${p.id}`, `pricing-config:registrationFee`],
          title: "Encaissement FI conforme au tarif configuré",
          explanation:
            `L'encaissement ${p.receiptNumber} (${dzd(p.amount)}, « ${(p.notes ?? "").slice(0, 60) || "frais d'inscription"} ») ` +
            `correspond au tarif d'inscription configuré${hasGradeRef ? ` (plat ${dzd(flat)} et par niveau ${grade} : ${dzd(gradeFee!)})` : ` (plat ${dzd(flat)})`} — ` +
            `le montant encaissé est conforme au catalogue.`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${isoDate(p.collectedAt)}`, sourceRef: `payments:${p.id}` },
            { label: "Tarif plat configuré", value: dzd(flat), sourceRef: "pricing-config:registrationFee" },
            ...(hasGradeRef
              ? [{ label: `Tarif par niveau configuré (${grade})`, value: dzd(gradeFee!), sourceRef: `pricing-config:registrationFeeByGrade:${grade}` }]
              : []),
          ],
          calculation: `${dzd(p.amount)} = tarif configuré`,
          suggestedSteps: [],
        }),
      );
      continue;
    }

    if (matchFlat || matchGrade) {
      // THE DIVERGENCE CLASS (the owner's example): follows one configured
      // convention, violates the other — the config tension made concrete.
      const followsGrade = matchGrade && !matchFlat;
      const followedRef = followsGrade
        ? `le tarif par niveau configuré (${grade} : ${dzd(gradeFee!)})`
        : `le tarif plat configuré (${dzd(flat)})`;
      const violatedRef = followsGrade
        ? `le tarif plat configuré (${dzd(flat)})`
        : `le tarif par niveau configuré (${grade} : ${dzd(gradeFee!)})`;
      const violatedValue = followsGrade ? flat : gradeFee!;
      const delta = p.amount - violatedValue;
      findings.push(
        finding("outlier_review", "warning", `price-fi-pay:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: delta,
          recordIds: { payment: p.id, receiptNumber: p.receiptNumber ?? undefined },
          sourceRefs: [`payments:${p.id}`, "pricing-config:registrationFee", `pricing-config:registrationFeeByGrade:${grade ?? "?"}`],
          title: "Encaissement FI en écart avec un des tarifs d'inscription configurés",
          explanation:
            `L'encaissement ${p.receiptNumber} (${dzd(p.amount)}, ${isoDate(p.collectedAt)}) règle des frais ` +
            `d'inscription (FI) et suit ${followedRef} — mais il VIOLE ${violatedRef} de ${dzd(delta)}. ` +
            `Le catalogue configuré porte deux conventions divergentes (tarif plat ${dzd(flat)} vs tarifs par niveau) : ` +
            `le montant est conforme à l'une et en écart avec l'autre. L'écart trouve sa cause la plus probable dans ` +
            `la CONFIGURATION elle-même (voir le constat « deux tarifs d'inscription divergents »), pas nécessairement ` +
            `dans l'encaissement — la décision appartient à la direction.`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${isoDate(p.collectedAt)} · ${p.method}`, sourceRef: `payments:${p.id}` },
            { label: "Élève concerné", value: studentLabel, sourceRef: p.studentId ? `student:${p.studentId}` : null },
            { label: "Tarif plat configuré", value: dzd(flat), sourceRef: "pricing-config:registrationFee" },
            ...(hasGradeRef
              ? [{ label: `Tarif par niveau configuré (${grade})`, value: dzd(gradeFee!), sourceRef: `pricing-config:registrationFeeByGrade:${grade}` }]
              : []),
            { label: "Écart vs la référence violée", value: `${dzd(p.amount)} − ${dzd(violatedValue)} = ${dzd(delta)}`, sourceRef: null },
            { label: "Provenance", value: paymentProvenanceFr(p), sourceRef: `payments:${p.id}#notes` },
          ],
          calculation: `${dzd(p.amount)} − ${dzd(violatedValue)} = ${dzd(delta)} d'écart avec ${followsGrade ? "le tarif plat" : "le tarif par niveau"} configuré`,
          possibleCauses: [
            `La configuration porte deux conventions divergentes : l'import Excel facture le tarif par niveau du classeur (${dzd(gradeFee ?? 0)} en ${grade ?? "?"}) tandis que le flux d'inscription facture le tarif plat (${dzd(flat)}) — cet encaissement suit la convention import.`,
            "Si le tarif plat est la vérité actuelle : la grille par niveau est restée aux prix de l'année du classeur (désynchronisation de configuration).",
            "Si le tarif par niveau est la vérité actuelle : le flux d'inscription sous-facture — à corriger dans le flux, pas dans les écritures passées.",
          ],
          suggestedSteps: [
            "Trancher la convention autoritaire (voir le constat de configuration « deux tarifs divergents »).",
            `Si le tarif plat (${dzd(flat)}) est autoritaire : régulariser l'excédent de ${dzd(delta)} par le flux existant (crédit/avoir) — jamais une écriture manuelle directe.`,
            "Si le tarif par niveau est autoritaire : aucun montant à régulariser — aligner le flux d'inscription et le tarif plat sur la grille par niveau.",
          ],
        }),
      );
      continue;
    }

    // Matches NEITHER configured reference.
    if (!hasGradeRef) {
      findings.push(
        finding("unverified", "info", `price-fi-pay-noref:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: p.amount - flat,
          recordIds: { payment: p.id, receiptNumber: p.receiptNumber ?? undefined },
          sourceRefs: [`payments:${p.id}`, "pricing-config:registrationFee"],
          title: "Encaissement FI à référence de prix incomplète",
          explanation:
            `L'encaissement ${p.receiptNumber} (${dzd(p.amount)}) règle des frais d'inscription mais ne correspond ` +
            `pas au tarif plat configuré (${dzd(flat)}) et le niveau de l'élève n'est pas déterminable — ` +
            `la référence par niveau ne peut être établie (non vérifiable).`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${isoDate(p.collectedAt)}`, sourceRef: `payments:${p.id}` },
            { label: "Tarif plat configuré", value: dzd(flat), sourceRef: "pricing-config:registrationFee" },
            { label: "Niveau de l'élève", value: "indéterminable", sourceRef: null },
          ],
          calculation: `${dzd(p.amount)} vs ${dzd(flat)} (plat) — référence par niveau indisponible`,
          possibleCauses: [
            "Le paiement ne référence aucun élève connu (sujet absent ou supprimé).",
          ],
          suggestedSteps: [
            "Rattacher le paiement à son élève (flux existant) puis relancer l'audit.",
          ],
        }),
      );
      continue;
    }
    findings.push(
      finding("confirmed_mismatch", "warning", `price-fi-pay-violation:${p.id}`, {
        parentId: p.parentId,
        parentName: ctx.displayName(p.parentId),
        amount: p.amount - flat,
        recordIds: { payment: p.id, receiptNumber: p.receiptNumber ?? undefined },
        sourceRefs: [`payments:${p.id}`, "pricing-config:registrationFee", `pricing-config:registrationFeeByGrade:${grade}`],
        title: "Encaissement FI non conforme aux tarifs configurés",
        explanation:
          `L'encaissement ${p.receiptNumber} (${dzd(p.amount)}) règle des frais d'inscription mais ne correspond ` +
          `à AUCUN tarif configuré : ni le tarif plat (${dzd(flat)}), ni le tarif par niveau ${grade} (${dzd(gradeFee)}) — ` +
          `un écart de ${dzd(p.amount - gradeFee!)} avec le tarif de son niveau. Le montant ne provient d'aucun prix ` +
          `du catalogue : à examiner (saisie, calcul ou majoration non configurée).`,
        evidence: [
          { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${isoDate(p.collectedAt)} · ${p.method}`, sourceRef: `payments:${p.id}` },
          { label: "Élève concerné", value: studentLabel, sourceRef: p.studentId ? `student:${p.studentId}` : null },
          { label: "Tarif plat configuré", value: dzd(flat), sourceRef: "pricing-config:registrationFee" },
          { label: `Tarif par niveau configuré (${grade})`, value: dzd(gradeFee!), sourceRef: `pricing-config:registrationFeeByGrade:${grade}` },
          { label: "Provenance", value: paymentProvenanceFr(p), sourceRef: `payments:${p.id}#notes` },
        ],
        calculation: `${dzd(p.amount)} vs ${dzd(flat)} (plat) et ${dzd(gradeFee!)} (niveau ${grade}) — écart ${dzd(p.amount - gradeFee!)} avec le tarif de niveau`,
        possibleCauses: [
          "Une majoration ou un FI négocié non documenté dans la configuration.",
          "Une erreur de saisie au comptoir ou dans le classeur source (un chiffre en trop).",
          "Un mélange de conventions lors d'une année de transition de tarification.",
        ],
        suggestedSteps: [
          "Retrouver l'origine du montant (reçu papier, ligne du classeur, journal d'audit).",
          "Si un prix négocié s'applique : le documenter dans la configuration pour lever le signalement.",
          "Sinon régulariser via le flux existant (crédit/avoir) — jamais une suppression directe.",
        ],
      }),
    );
  }

  // ── (ii) The registration CHARGES vs the configured references ───────
  for (const e of ctx.ledgerEntries) {
    if (e.type !== "charge" || !isRegistrationCharge(e)) continue;
    const student = e.studentId ? ctx.studentById.get(e.studentId) : undefined;
    const grade = student?.gradeLevel ?? null;
    const gradeFee = grade ? perGrade[grade] : undefined;
    const hasGradeRef = gradeFee != null && Number.isFinite(gradeFee) && gradeFee > 0;

    // The family-level registration fee (studentId null — the registration
    // flow's « nouvelle famille » convention) answers to the FLAT fee.
    const isFamilyLevel = e.studentId == null;
    const matchFlat = Math.abs(e.amount - flat) <= tol;
    const matchGrade = !isFamilyLevel && hasGradeRef && Math.abs(e.amount - gradeFee) <= tol;

    if (matchFlat || matchGrade) {
      findings.push(
        finding("reconciled", "ok", `price-fi-charge-ok:${e.id}`, {
          parentId: e.parentId,
          parentName: ctx.displayName(e.parentId),
          amount: e.amount,
          recordIds: { ledgerEntry: e.id },
          sourceRefs: [`ledger:${e.id}`, `source:${e.sourceType}/${e.sourceId}`, "pricing-config:registrationFee"],
          title: "Facture d'inscription conforme au tarif configuré",
          explanation:
            `La facture d'inscription ${e.id} (« ${(e.description ?? "").slice(0, 60)} », ${dzd(e.amount)}) correspond ` +
            `au tarif configuré (${isFamilyLevel || matchFlat ? `plat familial : ${dzd(flat)}` : `par niveau ${grade} : ${dzd(gradeFee!)}`}) — ` +
            `le montant facturé est conforme au catalogue.`,
          evidence: [
            { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
            { label: "Tarif configuré appliqué", value: isFamilyLevel || matchFlat ? `plat familial ${dzd(flat)}` : `par niveau ${grade} : ${dzd(gradeFee!)}`, sourceRef: isFamilyLevel || matchFlat ? "pricing-config:registrationFee" : `pricing-config:registrationFeeByGrade:${grade}` },
          ],
          calculation: `${dzd(e.amount)} = tarif configuré`,
          suggestedSteps: [],
        }),
      );
      continue;
    }

    findings.push(
      finding("outlier_review", "warning", `price-fi-charge:${e.id}`, {
        parentId: e.parentId,
        parentName: ctx.displayName(e.parentId),
        amount: e.amount - flat,
        recordIds: { ledgerEntry: e.id },
        sourceRefs: [`ledger:${e.id}`, `source:${e.sourceType}/${e.sourceId}`, "pricing-config:registrationFee"],
        title: "Facture d'inscription en écart avec le tarif configuré",
        explanation:
          `La facture d'inscription ${e.id} (« ${(e.description ?? "").slice(0, 60)} », ${dzd(e.amount)}) ne correspond ` +
          `pas au tarif plat configuré (${dzd(flat)})${hasGradeRef && !isFamilyLevel ? ` ni au tarif par niveau ${grade} (${dzd(gradeFee)})` : ""} — ` +
          `un écart de ${dzd(e.amount - flat)} avec le tarif familial configuré à examiner.`,
        evidence: [
          { label: `Écriture ${e.id}`, value: `${dzd(e.amount)} · ${isoDate(e.at)}`, sourceRef: `ledger:${e.id}` },
          { label: "Description", value: e.description ?? "—", sourceRef: `ledger:${e.id}#description` },
          { label: "Tarif plat configuré", value: dzd(flat), sourceRef: "pricing-config:registrationFee" },
          ...(hasGradeRef && !isFamilyLevel
            ? [{ label: `Tarif par niveau configuré (${grade})`, value: dzd(gradeFee!), sourceRef: `pricing-config:registrationFeeByGrade:${grade}` }]
            : []),
        ],
        calculation: `${dzd(e.amount)} − ${dzd(flat)} = ${dzd(e.amount - flat)} d'écart avec le tarif plat configuré`,
        possibleCauses: [
          "Un FI négocié ou majoré non reflété dans la configuration.",
          "Une désynchronisation entre le flux d'écriture et le catalogue (le flux facture un ancien tarif).",
        ],
        suggestedSteps: [
          "Vérifier le tarif convenu avec la famille (devis/paiement d'acompte).",
          "Documenter le prix négocié dans la configuration, ou régulariser via le flux d'ajustement existant.",
        ],
      }),
    );
  }
}

/* ================================================================== */
/*  Check 8 — Payment allocations (partial processing & identity)      */
/* ================================================================== */

function auditAllocations(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  const tol = ctx.thresholds.amountToleranceDzd;
  const allocationIdsByPayment = new Map<string, Set<string>>();

  for (const a of ctx.allocations) {
    const ids = allocationIdsByPayment.get(a.paymentId) ?? new Set<string>();
    ids.add(a.id);
    allocationIdsByPayment.set(a.paymentId, ids);

    const payment = ctx.paymentById.get(a.paymentId);
    if (!payment) {
      findings.push(
        finding("confirmed_mismatch", "warning", `alloc-nopay:${a.id}`, {
          parentId: null,
          parentName: null,
          amount: a.allocatedAmount,
          recordIds: { allocation: a.id },
          sourceRefs: [`allocations:${a.id}`, `payment:${a.paymentId}`],
          title: "Ventilation sans paiement source",
          explanation:
            `La ventilation ${a.id} (${dzd(a.allocatedAmount)}) référence le paiement ${a.paymentId} ` +
            `qui n'existe pas — la répartition persiste sans son encaissement d'origine.`,
          evidence: [
            { label: `Ventilation ${a.id}`, value: `${dzd(a.allocatedAmount)} · ${a.category ?? "multi-services"}`, sourceRef: `allocations:${a.id}` },
            { label: "Paiement référencé", value: `${a.paymentId} — introuvable`, sourceRef: null },
          ],
          calculation: null,
          suggestedSteps: ["Vérifier le journal d'audit de l'allocation et l'existence historique du paiement."],
        }),
      );
      continue;
    }

    // Identity mapping across merged/linked accounts (issue #30 scenario 15):
    // the allocation may only settle installments of the SAME family.
    if (a.installmentId) {
      const inst = ctx.installmentById.get(a.installmentId);
      if (!inst) {
        findings.push(
          finding("confirmed_mismatch", "warning", `alloc-noinst:${a.id}`, {
            parentId: payment.parentId,
            parentName: ctx.displayName(payment.parentId),
            amount: a.allocatedAmount,
            recordIds: { allocation: a.id, payment: payment.id },
            sourceRefs: [`allocations:${a.id}`, `installment:${a.installmentId}`],
            title: "Ventilation vers une échéance introuvable",
            explanation:
              `La ventilation ${a.id} du paiement ${payment.receiptNumber} (${dzd(a.allocatedAmount)}) cible ` +
              `l'échéance ${a.installmentId} qui n'existe pas — la répartition pointe vers une cible disparue.`,
            evidence: [
              { label: `Ventilation ${a.id}`, value: dzd(a.allocatedAmount), sourceRef: `allocations:${a.id}` },
              { label: "Échéance ciblée", value: `${a.installmentId} — introuvable`, sourceRef: null },
            ],
            calculation: null,
            suggestedSteps: ["Vérifier la suppression/fusion de l'échéance et régulariser la ventilation."],
          }),
        );
      } else if (inst.parentId !== payment.parentId) {
        findings.push(
          finding("confirmed_mismatch", "critical", `alloc-xparent:${a.id}`, {
            parentId: payment.parentId,
            parentName: ctx.displayName(payment.parentId),
            amount: a.allocatedAmount,
            recordIds: { allocation: a.id, payment: payment.id, installment: inst.id },
            sourceRefs: [`allocations:${a.id}`, `payments:${payment.id}`, `installments:${inst.id}`],
            title: "Ventilation croisant deux comptes famille",
            explanation:
              `Le paiement ${payment.receiptNumber} appartient au parent ${payment.parentId} mais sa ventilation ` +
              `${a.id} règle une échéance du parent ${inst.parentId} — un paiement d'une famille solde la dette ` +
              `d'une autre (mauvais mappage d'identité, typique d'une fusion de comptes mal appliquée).`,
            evidence: [
              { label: `Paiement ${payment.receiptNumber}`, value: `parent ${payment.parentId}`, sourceRef: `payments:${payment.id}` },
              { label: `Échéance ciblée ${inst.label}`, value: `parent ${inst.parentId}`, sourceRef: `installments:${inst.id}` },
            ],
            calculation: null,
            suggestedSteps: [
              "Vérifier l'historique de fusion des deux comptes famille.",
              "Régulariser les soldes des DEUX comptes via le flux d'ajustement existant.",
            ],
          }),
        );
      }
    }
  }

  // Σ allocations per payment must equal the payment's amount (partial
  // processing / inconsistent allocation detection).
  for (const p of ctx.payments) {
    const allocs = ctx.allocationsByPayment.get(p.id);
    if (!allocs || allocs.length === 0) continue; // unallocated ≠ inconsistent
    const allocated = allocs.reduce((s, a) => s + a.allocatedAmount, 0);
    const target = p.expectedAmount && p.expectedAmount > 0 ? Math.min(p.amount, p.expectedAmount) : p.amount;
    if (Math.abs(allocated - target) > tol) {
      findings.push(
        finding("confirmed_mismatch", "warning", `alloc-sum:${p.id}`, {
          parentId: p.parentId,
          parentName: ctx.displayName(p.parentId),
          amount: Math.abs(allocated - target),
          recordIds: { payment: p.id, receiptNumber: p.receiptNumber ?? undefined },
          sourceRefs: [`payments:${p.id}`, ...allocs.map((a) => `allocations:${a.id}`)],
          title: "Somme des ventilations ≠ montant du paiement",
          explanation:
            `Le paiement ${p.receiptNumber} (${dzd(p.amount)}) est ventilé à hauteur de ${dzd(allocated)} sur ` +
            `${allocs.length} ligne(s) — la répartition ne couvre pas le montant encaissé (écart ${dzd(allocated - target)}). ` +
            `Une part de l'argent n'est affectée à aucune échéance ni crédit.`,
          evidence: [
            { label: `Paiement ${p.receiptNumber}`, value: dzd(p.amount), sourceRef: `payments:${p.id}` },
            { label: "Σ ventilations", value: `${dzd(allocated)} sur ${allocs.length} ligne(s)`, sourceRef: null },
            ...allocs.slice(0, 5).map((a) => ({
              label: `Ventilation ${a.id}`,
              value: `${dzd(a.allocatedAmount)} · ${a.category ?? "multi-services"}`,
              sourceRef: `allocations:${a.id}`,
            })),
          ],
          calculation: `${dzd(allocated)} − ${dzd(target)} = ${dzd(allocated - target)} non affecté`,
          suggestedSteps: [
            "Vérifier si une ventilation a échoué partiellement (traitement interrompu).",
            "Régulariser l'affectation restante via le flux de collecte existant.",
          ],
        }),
      );
    }
  }
}

/* ================================================================== */
/*  Check 9 — Installment satisfaction integrity (INV-4 family)        */
/* ================================================================== */

function auditInstallmentSatisfaction(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  for (const i of ctx.installments) {
    if (i.status !== "paid") continue;
    // The canonical INV-4 remaining (clampNonNegative(due − paid − pending)):
    // a tranche marked "paid" with a POSITIVE remaining is unbacked.
    const remaining = installmentRemaining(i);
    const backing = i.amountPaid + (i.amountPending ?? 0);
    if (remaining > ctx.thresholds.amountToleranceDzd) {
      findings.push(
        finding("confirmed_mismatch", "critical", `inst-unbacked:${i.id}`, {
          parentId: i.parentId,
          parentName: ctx.displayName(i.parentId),
          amount: remaining,
          recordIds: { installment: i.id },
          sourceRefs: [`installments:${i.id}`],
          title: "Tranche « payée » sans fonds suffisants (INV-4)",
          explanation:
            `La tranche « ${i.label} » (${dzd(i.amountDue)}) est marquée « payée » alors que les fonds ` +
            `réglés (${dzd(i.amountPaid)}) + en attente (${dzd(i.amountPending ?? 0)}) ne couvrent que ${dzd(backing)} — ` +
            `la règle INV-4 n'est pas respectée : la tranche ne peut être « payée » que si amountPaid ≥ amountDue.`,
          evidence: [
            { label: `Tranche ${i.label}`, value: `${dzd(i.amountDue)} · statut ${i.status}`, sourceRef: `installments:${i.id}` },
            { label: "Fonds réglés (amountPaid)", value: dzd(i.amountPaid), sourceRef: `installments:${i.id}#amountPaid` },
            { label: "Fonds en attente (amountPending)", value: dzd(i.amountPending ?? 0), sourceRef: `installments:${i.id}#amountPending` },
          ],
          calculation: `${dzd(i.amountDue)} − (${dzd(i.amountPaid)} + ${dzd(i.amountPending ?? 0)}) = ${dzd(i.amountDue - backing)} non couverts`,
          suggestedSteps: [
            "Vérifier les paiements/ventilations censés couvrir cette tranche (allocations manquantes ?).",
            "Corriger le statut via le flux existant — jamais une édition directe de ligne.",
          ],
        }),
      );
    }
  }
}

/* ================================================================== */
/*  Check 10 — Per-parent reconciliation (canonical, §15.18)           */
/*  The T-168 adjustment-aware equation from computeParentBilling-     */
/*  Breakdown — reused, never re-derived — plus the Example-A          */
/*  future-dated-payment arithmetic that explains a server/derived     */
/*  divergence.                                                        */
/* ================================================================== */

function auditParentReconciliation(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
): void {
  const tol = ctx.thresholds.amountToleranceDzd;
  const graceMs = ctx.thresholds.futureDateGraceDays * 86_400_000;
  // The "full replay" clock: every entry counts regardless of date.
  const FULL_REPLAY_NOW = new Date(8_640_000_000_000_000);

  const ledgerByParent = new Map<string, LedgerEntry[]>();
  for (const e of ctx.ledgerEntries) {
    const list = ledgerByParent.get(e.parentId) ?? [];
    list.push(e);
    ledgerByParent.set(e.parentId, list);
  }
  const paymentsByParent = new Map<string, Payment[]>();
  for (const p of ctx.payments) {
    const list = paymentsByParent.get(p.parentId) ?? [];
    list.push(p);
    paymentsByParent.set(p.parentId, list);
  }

  const parentsToAudit = new Set<string>([
    ...ledgerByParent.keys(),
    ...paymentsByParent.keys(),
    ...ctx.debtSummaries.map((d) => d.parentId),
  ]);

  for (const parentId of parentsToAudit) {
    const parent = ctx.parentById.get(parentId);
    const parentName = parent ? parentDisplayName(parent) : parentId;
    const entries = ledgerByParent.get(parentId) ?? [];
    const pays = paymentsByParent.get(parentId) ?? [];
    const debt = ctx.debtByParent.get(parentId);

    // ── The TWO canonical replays (computeParentSummary, the ONE balance
    //    engine): the AS-OF replay (the audit clock — the same semantics
    //    every displayed balance uses: entries after `now` are excluded)
    //    and the FULL replay (every entry counts, future-dated included).
    //    This IS the Example-A mechanism, live in the canonical engine.
    const asOfSummary = computeParentSummary(
      entries, parentId, parentName, new Map(), new Date(ctx.nowMs),
    );
    const fullSummary = computeParentSummary(
      entries, parentId, parentName, new Map(), FULL_REPLAY_NOW,
    );
    const asOfOutstanding = asOfSummary.totalOutstanding;
    const fullOutstanding = fullSummary.totalOutstanding;

    // ── The future-dated COLLECTED payments (Example A's engine) ──────
    const futurePaid = pays
      .filter((p) => (p.status === "paid" || p.status === "partial"))
      .filter((p) => {
        const ms = Date.parse(p.collectedAt);
        return Number.isFinite(ms) && ms > ctx.nowMs + graceMs;
      });
    const futurePaidTotal = futurePaid.reduce((s, p) => s + p.amount, 0);

    if (!debt) {
      // No server summary: the ledger replay is the only view.
      if (entries.length > 0) {
        findings.push(
          finding("unverified", "info", `recon-nosrv:${parentId}`, {
            parentId,
            parentName,
            amount: asOfOutstanding,
            recordIds: {},
            sourceRefs: [`parent:${parentId}`, `ledger:parent/${parentId}`],
            title: "Solde serveur non disponible pour ce compte",
            explanation:
              `Le compte ${parentName} porte ${entries.length} écriture(s) de grand livre mais aucun résumé de ` +
              `créance serveur — la réconciliation croisée serveur/grand livre ne peut être établie (non vérifiable).`,
            evidence: [
              { label: "Écritures du compte", value: `${entries.length} ligne(s)`, sourceRef: `ledger:parent/${parentId}` },
              { label: "Résumé de créance serveur", value: "absent", sourceRef: null },
            ],
            calculation: null,
            suggestedSteps: ["Recharger le flux des créances (seed) et relancer l'audit."],
          }),
        );
      }
      continue;
    }

    const serverOutstanding = debt.outstandingAmount;
    const serverMatchesAsOf = Math.abs(serverOutstanding - asOfOutstanding) <= tol;
    const serverMatchesFull = Math.abs(serverOutstanding - fullOutstanding) <= tol;

    if (futurePaidTotal > tol) {
      // ── THE EXAMPLE-A DETECTOR (generalized) ────────────────────────
      // The as-of balance excludes payments the records claim COLLECTED:
      // asOf = full + futurePaid whenever the future entries are the only
      // difference — a fully-paid account reports false debt.
      const f = finding("date_semantic_conflict", "critical", `recon-future:${parentId}`, {
        parentId,
        parentName,
        amount: futurePaidTotal,
        recordIds: { payment: futurePaid[0]?.id },
        sourceRefs: [
          `parent:${parentId}`,
          ...futurePaid.slice(0, 8).map((p) => `payments:${p.id}`),
        ],
        title: "Solde « à ce jour » faussé par des paiements datés dans le futur",
        explanation:
          `${futurePaid.length} paiement(s) « payé(s) » totalisant ${dzd(futurePaidTotal)} portent une date de ` +
          `collecte dans le futur : le replay « à ce jour » du grand livre les EXCLUT, alors que le replay complet ` +
          `donne ${dzd(fullOutstanding)}. Le compte affiche donc ${dzd(asOfOutstanding)} de dette apparente` +
          `${Math.abs(asOfOutstanding - (fullOutstanding + futurePaidTotal)) <= tol ? " — exactement le montant des paiements futurs exclus" : ""}. ` +
          (serverMatchesAsOf
            ? `Le solde serveur (${dzd(serverOutstanding)}) porte la MÊME dette apparente — le compte apparaît devoir à tort ` +
              `alors que le relevé importé marque tout réglé. `
            : serverMatchesFull
              ? `Le solde serveur (${dzd(serverOutstanding)}) compte déjà les paiements futurs (≈ replay complet) — ` +
                `les dates restent sémantiquement suspectes mais la réconciliation tient. `
              : `Le solde serveur (${dzd(serverOutstanding)}) ne concorde ni avec le replay « à ce jour » ` +
                `(${dzd(asOfOutstanding)}) ni avec le replay complet (${dzd(fullOutstanding)}) — voir l'écart non expliqué. `) +
          `Cause probable : l'import a assigné des dates de tranches/planning à des paiements dont la source ne ` +
          `contenait pas de dates réelles de collecte.`,
        evidence: [
          { label: "Replay « à ce jour » (aujourd'hui)", value: dzd(asOfOutstanding), sourceRef: `ledger:parent/${parentId}` },
          { label: "Replay complet (toutes écritures)", value: dzd(fullOutstanding), sourceRef: `ledger:parent/${parentId}` },
          { label: "Paiements payés datés dans le futur", value: `${futurePaid.length} paiement(s) = ${dzd(futurePaidTotal)}`, sourceRef: null },
          { label: "Solde serveur (créances)", value: dzd(serverOutstanding), sourceRef: `debt-summary:${parentId}` },
          ...futurePaid.slice(0, 5).map((p) => ({
            label: `Paiement ${p.receiptNumber}`,
            value: `${dzd(p.amount)} · collecté le ${isoDate(p.collectedAt)}`,
            sourceRef: `payments:${p.id}`,
          })),
        ],
        calculation:
          `${dzd(fullOutstanding)} (replay complet) + ${dzd(futurePaidTotal)} (payés futurs exclus du « à ce jour ») = ` +
          `${dzd(fullOutstanding + futurePaidTotal)} ≈ le solde « à ce jour » ${dzd(asOfOutstanding)}`,
        suggestedSteps: [
          "Vérifier la correspondance d'import des dates : la feuille source ne contenait probablement pas de dates réelles de paiement (dates de tranches utilisées comme convention).",
          "Distinguer les VRAIS paiements planifiés (échéances futures non payées) des paiements historiques mal datés.",
          "Ne PAS réécrire les dates ou les soldes automatiquement — la remédiation passe par le flux d'import revu, avec trace d'audit.",
        ],
      });
      findings.push(f);

      if (!serverMatchesAsOf && !serverMatchesFull) {
        findings.push(
          finding("confirmed_mismatch", "warning", `recon-gap:${parentId}`, {
            parentId,
            parentName,
            amount: Math.abs(serverOutstanding - asOfOutstanding),
            recordIds: {},
            sourceRefs: [`parent:${parentId}`, `debt-summary:${parentId}`, `ledger:parent/${parentId}`],
            title: "Solde serveur ≠ replay du grand livre (écart non expliqué)",
            explanation:
              `Le solde serveur (${dzd(serverOutstanding)}) ne concorde ni avec le replay « à ce jour » ` +
              `(${dzd(asOfOutstanding)}) ni avec le replay complet (${dzd(fullOutstanding)}) — les vues ` +
              `« créances », « paiements » et « grand livre » ne réconcilient pas sous les règles canoniques.`,
            evidence: [
              { label: "Solde serveur", value: dzd(serverOutstanding), sourceRef: `debt-summary:${parentId}` },
              { label: "Replay « à ce jour »", value: dzd(asOfOutstanding), sourceRef: `ledger:parent/${parentId}` },
              { label: "Replay complet", value: dzd(fullOutstanding), sourceRef: `ledger:parent/${parentId}` },
            ],
            calculation: `${dzd(serverOutstanding)} − ${dzd(asOfOutstanding)} = ${dzd(serverOutstanding - asOfOutstanding)}`,
            suggestedSteps: [
              "Comparer les totaux par catégorie (charges / paiements / ajustements) pour localiser la divergence.",
              "Vérifier les écritures récemment extournées ou les écritures orphelines signalées par ailleurs.",
            ],
          }),
        );
      }
      continue;
    }

    if (serverMatchesAsOf) {
      // Clean reconciliation — server ≡ as-of replay, no future exposure.
      findings.push(
        finding("reconciled", "ok", `recon-ok:${parentId}`, {
          parentId,
          parentName,
          amount: serverOutstanding,
          recordIds: {},
          sourceRefs: [`parent:${parentId}`, `debt-summary:${parentId}`],
          title: "Solde réconcilié (serveur ≡ grand livre)",
          explanation:
            `Le solde serveur (${dzd(serverOutstanding)}) correspond au replay « à ce jour » du grand livre ` +
            `(${dzd(asOfOutstanding)}) — les vues « créances », « paiements » et « grand livre » réconcilient.`,
          evidence: [
            { label: "Solde serveur", value: dzd(serverOutstanding), sourceRef: `debt-summary:${parentId}` },
            { label: "Replay « à ce jour »", value: dzd(asOfOutstanding), sourceRef: `ledger:parent/${parentId}` },
            { label: "Replay complet", value: dzd(fullOutstanding), sourceRef: `ledger:parent/${parentId}` },
          ],
          calculation: null,
          suggestedSteps: [],
        }),
      );
    } else {
      // Unexplained server-vs-replay divergence (no future explanation).
      findings.push(
        finding("confirmed_mismatch", "warning", `recon-gap:${parentId}`, {
          parentId,
          parentName,
          amount: Math.abs(serverOutstanding - asOfOutstanding),
          recordIds: {},
          sourceRefs: [`parent:${parentId}`, `debt-summary:${parentId}`, `ledger:parent/${parentId}`],
          title: "Solde serveur ≠ replay du grand livre (écart non expliqué)",
          explanation:
            `Le solde serveur (${dzd(serverOutstanding)}) et le replay « à ce jour » du grand livre ` +
            `(${dzd(asOfOutstanding)}) divergent de ${dzd(serverOutstanding - asOfOutstanding)} sans explication ` +
            `par des paiements futurs (0 DZD). Les vues « créances », « paiements » et « grand livre » ne ` +
            `réconcilient pas sous les règles canoniques.`,
          evidence: [
            { label: "Solde serveur", value: dzd(serverOutstanding), sourceRef: `debt-summary:${parentId}` },
            { label: "Replay « à ce jour »", value: dzd(asOfOutstanding), sourceRef: `ledger:parent/${parentId}` },
            { label: "Écart", value: dzd(serverOutstanding - asOfOutstanding), sourceRef: null },
            { label: "Paiements payés futurs", value: "0 DZD", sourceRef: null },
          ],
          calculation: `${dzd(serverOutstanding)} − ${dzd(asOfOutstanding)} = ${dzd(serverOutstanding - asOfOutstanding)}`,
          suggestedSteps: [
            "Comparer les totaux par catégorie (charges / paiements / ajustements) pour localiser la divergence.",
            "Vérifier les écritures récemment extournées ou les écritures orphelines signalées par ailleurs.",
          ],
        }),
      );
    }
  }
}

/* ================================================================== */
/*  Reconciled per-payment findings (the issue's "Reconciled" class)   */
/*  A payment with exactly one ledger twin, matching amount/status/    */
/*  customer, sane dates, no duplicate signature, and complete         */
/*  allocations — every DZD traceable to a concrete collection event.  */
/* ================================================================== */

function auditReconciledPayments(
  ctx: AuditContext,
  findings: WebhookDiagnosticFinding[],
  flaggedPaymentIds: ReadonlySet<string>,
): void {
  for (const p of ctx.payments) {
    if (flaggedPaymentIds.has(p.id)) continue;
    const entries = ctx.ledgerPaymentsBySourceId.get(p.id) ?? [];
    if (entries.length !== 1) continue; // 0 or >1 are both flagged shapes
    const entry = entries[0];
    const allocs = ctx.allocationsByPayment.get(p.id) ?? [];
    findings.push(
      finding("reconciled", "ok", `pay-ok:${p.id}`, {
        parentId: p.parentId,
        parentName: ctx.displayName(p.parentId),
        amount: p.amount,
        recordIds: { payment: p.id, ledgerEntry: entry.id, receiptNumber: p.receiptNumber ?? undefined },
        sourceRefs: [`payments:${p.id}`, `ledger:${entry.id}`, `receipt:${p.receiptNumber}`],
        title: "Paiement tracé et cohérent",
        explanation:
          `Le paiement ${p.receiptNumber} (${dzd(p.amount)}, ${p.method}, ${isoDate(p.collectedAt)}) est fidèlement ` +
          `comptabilisé : une seule écriture de grand livre (${entry.id}, ${dzd(Math.abs(entry.amount))}), même client ` +
          `(${p.parentId}), même statut (${p.status}), date de collecte passée` +
          `${allocs.length > 0 ? `, ventilé sur ${allocs.length} échéance(s) pour un total conforme` : ""}. ` +
          `Le montant est rattaché à un événement d'encaissement concret et traçable.`,
        evidence: [
          { label: `Paiement ${p.receiptNumber}`, value: `${dzd(p.amount)} · ${p.method} · ${p.status}`, sourceRef: `payments:${p.id}` },
          { label: `Écriture ${entry.id}`, value: `${dzd(Math.abs(entry.amount))} · ${isoDate(entry.at)}`, sourceRef: `ledger:${entry.id}` },
          ...(allocs.length > 0
            ? [{ label: "Ventilations", value: allocs.map((a) => dzd(a.allocatedAmount)).join(" + "), sourceRef: null as string | null }]
            : []),
        ],
        calculation: allocs.length > 0
          ? `${allocs.map((a) => dzd(a.allocatedAmount)).join(" + ")} = ${dzd(allocs.reduce((s, a) => s + a.allocatedAmount, 0))} = montant du paiement`
          : null,
        suggestedSteps: [],
      }),
    );
  }
}

/* ================================================================== */
/*  THE ENTRY POINT — the whole-books read-only audit                  */
/* ================================================================== */

/**
 * Run the Webhook & Ledger Traceability Diagnostics over the loaded
 * financial streams. PURE: no repository call, no mutation, no clock read
 * (inject `now`), no row limits (every record is audited — the UI
 * paginates; the engine NEVER silently omits).
 */
export function runWebhookDiagnostics(params: {
  readonly payments: readonly Payment[];
  readonly installments: readonly Installment[];
  readonly ledgerEntries: readonly LedgerEntry[];
  readonly allocations: readonly PaymentAllocation[];
  readonly debtSummaries: readonly DebtSummary[];
  readonly parents: readonly Parent[];
  readonly students: readonly Student[];
  /**
   * T-529 (AUDIT-510): the ACTIVE configured price catalog (the structural
   * subset this audit consumes — the desktop's full PricingConfig satisfies
   * it structurally). When absent, the configured-price compliance checks
   * emit ONE honest `unverified` coverage finding (never silent, never
   * spam) and the price basis falls back to the T-425 official matrix.
   */
  readonly pricingConfig?: WebhookDiagnosticsPricingConfig | null;
  /** The audit clock — ISO string or epoch ms. Defaults to Date.now(). */
  readonly now?: string | number;
  readonly thresholds?: Partial<WebhookDiagnosticsThresholds>;
}): WebhookDiagnosticsReport {
  const nowMs =
    params.now === undefined
      ? Date.now()
      : typeof params.now === "number"
        ? params.now
        : Date.parse(params.now);
  const thresholds: WebhookDiagnosticsThresholds = {
    ...DEFAULT_WEBHOOK_DIAGNOSTICS_THRESHOLDS,
    ...params.thresholds,
  };

  const ctx = buildAuditContext({
    payments: params.payments,
    installments: params.installments,
    ledgerEntries: params.ledgerEntries,
    allocations: params.allocations,
    debtSummaries: params.debtSummaries,
    parents: params.parents,
    students: params.students,
    pricingConfig: params.pricingConfig ?? null,
    nowMs,
    thresholds,
  });

  const findings: WebhookDiagnosticFinding[] = [];

  auditPaymentLedgerConsistency(ctx, findings);
  auditDateSemantics(ctx, findings);
  auditDuplicates(ctx, findings);
  auditOrphanLedgerEntries(ctx, findings);
  auditChargeJustification(ctx, findings);
  auditAdjustmentsAndRefunds(ctx, findings);
  auditPriceBasis(ctx, findings);
  auditConfiguredPriceCompliance(ctx, findings);
  auditAllocations(ctx, findings);
  auditInstallmentSatisfaction(ctx, findings);
  auditParentReconciliation(ctx, findings);

  // The reconciled-payment pass runs LAST, over the payments no earlier
  // check implicated.
  const flaggedPaymentIds = new Set<string>();
  for (const f of findings) {
    if (f.recordIds.payment) flaggedPaymentIds.add(f.recordIds.payment);
    // duplicate-tuple findings flag the whole group via sourceRefs
    if (f.category === "duplicate_event") {
      for (const ref of f.sourceRefs) {
        const m = /^payments:(.+)$/.exec(ref);
        if (m) flaggedPaymentIds.add(m[1]);
      }
    }
  }
  auditReconciledPayments(ctx, findings, flaggedPaymentIds);

  const counts: WebhookFindingCounts = {
    confirmed_mismatch: 0,
    duplicate_event: 0,
    unjustified_amount: 0,
    outlier_review: 0,
    date_semantic_conflict: 0,
    unverified: 0,
    reconciled: 0,
  };
  for (const f of findings) counts[f.category] += 1;

  return {
    asOf: new Date(nowMs).toISOString(),
    thresholds,
    coverage: {
      payments: ctx.payments.length,
      ledgerEntries: ctx.ledgerEntries.length,
      installments: ctx.installments.length,
      allocations: ctx.allocations.length,
      parents: ctx.parents.length,
      pricingConfig: ctx.pricingConfig !== null,
      chargeForms: ctx.chargeForms,
    },
    counts,
    findings,
  };
}
