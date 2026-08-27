/**
 * cross-platform-v2 — Canonical scenario types.
 *
 * A scenario is a deterministic, platform-neutral description of:
 *   GIVEN a complete initial domain state (money in CENTIMES, ISO timestamps)
 *   WHEN a sequence of business operations executes
 *   THEN the complete resulting domain state must be IDENTICAL on
 *        Android, Desktop, Website, and Backend (SQL/RPC/triggers).
 *
 * The same JSON bytes are fed to every platform adapter. Adapters translate
 * to their native representation (desktop: DZD number, Android: Long
 * centimes, backend: numeric(12,2) DZD), execute through their REAL
 * production code paths, and emit a normalized PlatformResult.
 */

// ─── Scenario input ────────────────────────────────────────────────────────

export interface CanonicalScenario {
  id: string;
  domain: "financial" | "academic" | "crm" | "aging" | "sync" | "backend_hidden";
  caseType: "normal" | "boundary" | "invalid" | "repeated" | "correction"
    | "cancellation" | "historical" | "complex" | "property";
  description: string;
  /** Platforms expected to reject the operation (error equivalence). */
  expectsError?: boolean;
  given: Given;
  when: Operation[];
  then?: CanonicalExpectation;
}

export interface Given {
  /** Deterministic clock for app-side engines (ISO-8601 UTC). */
  now: string;
  tenantId: string;
  parent: {
    id: string;
    code: string;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string | null;
  };
  students: Array<{
    id: string;
    parentId: string;
    code: string;
    firstName: string;
    lastName: string;
    gradeLevel: string;
    paymentPlan: "full_annual" | "tranches";
    enrollmentDate: string;
    /** For discount scenarios. */
    previousGradeLevel?: string | null;
    previousRank?: number | null;
    childIndex?: number;
  }>;
  /** Ledger entries pre-existing state (centimes, signed). */
  ledgerEntries?: CanonicalLedgerEntry[];
  /** Installments (centimes). */
  installments?: CanonicalInstallment[];
  /** Assessments for academic scenarios. */
  assessments?: CanonicalAssessment[];
  /** Attendance records for rate scenarios. */
  attendanceRecords?: Array<{
    studentId: string;
    date: string;
    status: "present" | "absent" | "late";
  }>;
  /** Academic year context. */
  academicYearStartYear?: number;
  academicYearStart?: string;
}

export interface CanonicalLedgerEntry {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  amount: number; // centimes, signed (+charge / −payment)
  type: "charge" | "payment" | "adjustment" | "refund" | "reversal" | "transfer";
  sourceType: string;
  sourceId: string;
  method: string | null;
  receiptNumber: string | null;
  paymentStatus: string | null;
  reversesId: string | null;
  description: string;
  actorId: string;
  actorName: string;
  at: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalInstallment {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  label: string;
  trancheNumber: number;
  amountDue: number; // centimes
  amountPaid: number;
  amountPending: number;
  dueDate: string; // ISO date-time (UTC midnight)
  paidDate: string | null;
  status: string;
}

export interface CanonicalAssessment {
  studentId: string;
  subjectId: string;
  subjectName?: string;
  term: "T1" | "T2" | "T3";
  academicYear?: string;
  devoir1: number | null; // 0–20, 2 decimals
  devoir2: number | null;
  examen: number | null;
  coefficient: number;
  isExtracurricular?: boolean;
  coefficientDevoir1?: number;
  coefficientDevoir2?: number;
  coefficientExamen?: number;
}

// ─── Operation vocabulary (executed by every adapter through REAL code) ───

export type Operation =
  | { type: "collectPayment"; amount: number; method: "cash" | "check" | "transfer";
      category?: string; status?: "paid" | "pending"; paymentId?: string;
      checkNumber?: string; checkBankName?: string; proofPath?: string;
      transferReference?: string; notes?: string }
  | { type: "refundPayment"; paymentId: string; amount?: number; reason?: string }
  | { type: "clearPayment"; paymentId: string }
  | { type: "bouncePayment"; paymentId: string; reason: string }
  | { type: "computeSummary" }
  | { type: "agingBucket"; daysOverdue: number; relativeToNow?: boolean }
  | { type: "subjectAverage"; studentId: string; subjectId: string }
  | { type: "overallGpa"; studentId: string }
  | { type: "attendanceRate"; studentId: string }
  | { type: "validateScore"; value: number }
  | { type: "parentCode" }
  | { type: "activationCode"; parentCode?: string; tenantId?: string }
  | { type: "bindActivationCode"; code: string; expired?: boolean; alreadyBound?: boolean }
  | { type: "evaluateDiscounts"; studentId: string; grossTuition: number; paymentDate?: string }
  | { type: "syncPushPayment"; paymentIndex: number } // Android-origin push path
  | { type: "websiteDerivedState" } // Website financial-view computations
  | { type: "sqlStateDump" }; // Backend persisted-state verification

// ─── Normalized platform result (what every adapter emits) ─────────────────

export interface PlatformResult {
  scenarioId: string;
  platform: "desktop" | "android" | "website" | "backend";
  ok: boolean;
  error?: string;
  /** Installment-level post-operation state (semantic key → state). */
  installments?: Array<{
    key: string; // e.g. "T1" / "ins-1" / tranche number
    amountPaid: number;
    amountPending: number;
    status: string;
  }>;
  /** Parent-level summary totals (centimes). */
  summary?: {
    totalCharged?: number;
    totalPaid?: number;
    totalPending?: number;
    totalOutstanding?: number;
    totalOverdue?: number;
    totalUnallocatedCredit?: number;
    totalCleared?: number;
    totalRefunded?: number;
    totalAdjusted?: number;
  };
  /** Per-payment allocation records. */
  allocations?: Array<{
    paymentKey: string;
    items: Array<{
      installmentKey: string;
      allocatedAmount: number;
      newAmountPaid: number;
      newAmountPending: number;
      newStatus: string;
      cleared: boolean;
    }>;
    unallocatedAmount: number;
  }>;
  /** Ledger totals by entry type (centimes, signed sums). */
  ledgerTotals?: Record<string, number>;
  ledgerEntryCount?: Record<string, number>;
  /** Single-value operation results. */
  values?: Record<string, number | string | boolean | null>;
  /** Errors per operation (for error-equivalence: all platforms must reject). */
  operationErrors?: Array<{ opIndex: number; message: string }>;
  /** Website-rendered derived values. */
  websiteDerived?: {
    balanceDue?: number;
    totalPaid?: number;
    totalDue?: number;
    nextDueDays?: number | null;
    attendanceRate?: number;
    averageGrade?: number | null;
    gpa?: number | null;
  };
  /** Backend persisted-state evidence. */
  backendState?: {
    paymentsCount?: number;
    ledgerCount?: number;
    auditCount?: number;
    activationCodes?: Array<{ code: string; bound: boolean; expired: boolean }>;
    receiptNumbers?: string[];
    matviewAgingBucket?: string | null;
    triggerEffects?: Record<string, unknown>;
  };
}

// ─── Optional canonical expectations ───────────────────────────────────────

export interface CanonicalExpectation {
  summary?: Record<string, number>;
  values?: Record<string, number | string | boolean | null>;
}
