/**
 * Android Mirror Equivalence Test Runner — TypeScript.
 *
 * Reads the SAME canonical JSON scenarios as `desktop/desktop_runner.ts`,
 * runs each through the **Kotlin-mirror engine** (a TypeScript port of the
 * Android Kotlin financial engine), and writes results to
 * `results/android_mirror/<scenario_id>.json`.
 *
 * The Kotlin-mirror engine (`android_mirror/kotlin_mirror_engine.ts`) is a
 * LINE-BY-LINE port of the actual Kotlin source at:
 *   - app/src/main/java/com/example/core/LedgerEngine.kt
 *   - app/src/main/java/com/example/core/Ledger.kt
 *   - app/src/main/java/com/example/core/LedgerEntryFactory.kt
 *   - app/src/main/java/com/example/core/WaterfallAllocation.kt
 *   - app/src/main/java/com/example/core/DiscountEngine.kt
 *   - app/src/main/java/com/example/core/IdentityCodes.kt
 *   - app/src/main/java/com/example/core/Reconcile.kt
 *
 * It uses the SAME representation as the Kotlin engine (centimes Long) —
 * unlike the desktop engine which uses DZD `number`. So the comparison
 * between desktop_runner and this android_mirror_runner is a TRUE
 * cross-platform comparison between two independent implementations
 * using different numeric representations.
 *
 * Output shape matches `desktop_runner.ts` exactly so the comparator can
 * diff them transparently.
 *
 * Usage:
 *   npx tsx android_mirror/android_mirror_runner.ts                       # run all scenarios
 *   npx tsx android_mirror/android_mirror_runner.ts scenarios/001_*.json   # run specific
 *   npx tsx android_mirror/android_mirror_runner.ts --generated           # also run generated
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  computeAccountBalance,
  computeParentSummary,
  deriveAccountId,
  allocatePaymentToInstallments,
  revertPaymentAllocation,
  evaluateAllSystemDiscounts,
  sumDiscounts,
  reconcileLedger,
  buildOverdueDueDateMap,
  PaymentCategory_fromCode,
  PaymentStatus_fromCode,
  PaymentPlan_fromCode,
  type LedgerEntry,
  type WaterfallInstallment,
  type CrossCheckInputs,
  type ParentSummaryCrossCheck,
  type InstallmentCrossCheck,
  type PaymentCrossCheck,
  type PaymentCategoryCode,
  type PaymentStatusCode,
  type PaymentPlanCode,
} from "./kotlin_mirror_engine";

// ─────────────────────────────────────────────────────────────────────────
// Canonical scenario format — mirrors desktop_runner.ts
// ─────────────────────────────────────────────────────────────────────────

interface CanonicalLedgerEntry {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  amount: number;     // centimes
  type: string;
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

interface CanonicalInstallment {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  label: string;
  amountDue: number;
  amountPaid: number;
  amountPending: number;
  dueDate: string;
  paidDate: string | null;
  status: string;
}

interface CanonicalPayment {
  id: string;
  parentId: string;
  studentId: string | null;
  amount: number;
  method: string;
  status: string;
  category: string;
  receiptNumber: string;
  installmentId: string | null;
  collectedBy: string;
  collectedAt: string;
}

interface CanonicalScenario {
  id: string;
  description: string;
  category: string;
  tags?: string[];
  given: {
    tenantId: string;
    parent?: { id: string; name: string };
    students?: Array<{ id: string; parentId: string; gradeLevel: string; paymentPlan?: string }>;
    ledgerEntries: CanonicalLedgerEntry[];
    installments?: CanonicalInstallment[];
    payments?: CanonicalPayment[];
    academicYearStartYear?: number;
  };
  when: {
    type: string;
    [key: string]: unknown;
  };
  then?: Record<string, unknown>;
}

/**
 * Convert a canonical scenario ledger entry (centimes Long) → mirror LedgerEntry.
 * Unlike desktop_runner which divides by 100 to convert to DZD, we KEEP centimes
 * because the Kotlin engine natively uses Long centimes.
 */
function toMirrorLedgerEntry(e: CanonicalLedgerEntry): LedgerEntry {
  return {
    id: e.id,
    tenantId: "t1",
    accountId: deriveAccountId(e.parentId, PaymentCategory_fromCode(e.category) as PaymentCategoryCode, e.studentId),
    parentId: e.parentId,
    studentId: e.studentId,
    category: PaymentCategory_fromCode(e.category) as PaymentCategoryCode,
    amount: e.amount,
    type: e.type as LedgerEntry["type"],
    sourceType: e.sourceType as LedgerEntry["sourceType"],
    sourceId: e.sourceId,
    method: e.method ? (e.method as LedgerEntry["method"]) : null,
    receiptNumber: e.receiptNumber,
    paymentStatus: e.paymentStatus ? (e.paymentStatus as LedgerEntry["paymentStatus"]) : null,
    reversesId: e.reversesId,
    description: e.description,
    actorId: e.actorId,
    actorName: e.actorName,
    at: e.at,
    metadata: e.metadata ?? {},
  };
}

function toMirrorInstallment(i: CanonicalInstallment): WaterfallInstallment {
  return {
    id: i.id,
    category: PaymentCategory_fromCode(i.category) as PaymentCategoryCode,
    amountDue: i.amountDue,
    amountPaid: i.amountPaid,
    amountPending: i.amountPending,
    dueDate: i.dueDate,
    status: i.status,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Operation dispatch — mirrors desktop_runner.ts exactly.
// All money values stay in centimes (no DZD conversion).
// ─────────────────────────────────────────────────────────────────────────

interface OperationResult {
  totalOutstanding?: number;
  totalPaid?: number;
  totalCharged?: number;
  totalOverdue?: number;
  totalCleared?: number;
  totalPending?: number;
  totalUnallocatedCredit?: number;
  balance?: number;
  totalAdjusted?: number;
  totalRefunded?: number;
  accounts?: Array<{
    accountId: string;
    category: string;
    studentId: string | null;
    balance: number;
    unallocatedCredit: number;
    totalCharged: number;
    totalPaid: number;
    totalAdjusted: number;
    isOverdue: boolean;
  }>;
  installments?: Array<{
    id: string;
    amountPaid: number;
    amountPending: number;
    status: string;
  }>;
  violations?: Array<{ severity: string; code: string; message: string }>;
  violationCodes?: string[];
  pass?: boolean;
  errorCount?: number;
  warningCount?: number;
  discountsApplied?: string[];
  totalDiscount?: number;
  evaluations?: Array<{ code: string; label: string; amount: number; applied: boolean; reason: string }>;
  allocations?: Array<{
    installmentId: string;
    allocatedAmount: number;
    newAmountPaid: number;
    newAmountPending: number;
    newStatus: string;
    fullySatisfied: boolean;
    cleared: boolean;
  }>;
  reverts?: Array<{
    installmentId: string;
    revertedAmount: number;
    newAmountPaid: number;
    newAmountPending: number;
    newStatus: string;
    reopened: boolean;
  }>;
  totalReverted?: number;
  unrevertedAmount?: number;
  reversalAmount?: number;
  unallocatedAmount?: number;
  totalAllocated?: number;
  paymentAmount?: number;
  error?: string;
}

function runOperation(scenario: CanonicalScenario): OperationResult {
  const given = scenario.given;
  const when = scenario.when;
  const entries = given.ledgerEntries.map(toMirrorLedgerEntry);

  switch (when.type) {
    case "computeAccountBalance": {
      const accountId = when.accountId as string;
      const bal = computeAccountBalance(entries, accountId);
      return {
        balance: bal.balance,
        totalCharged: bal.totalCharged,
        totalPaid: bal.totalPaid,
        totalAdjusted: bal.totalAdjusted,
        unallocatedCredit: bal.unallocatedCredit,
        totalRefunded: bal.totalRefunded,
        totalCleared: bal.totalCleared,
        totalPending: bal.totalPending,
      };
    }

    case "computeParentSummary": {
      // Match desktop_runner.ts: pass NO overdueDueDates (so totalOverdue
      // is computed from the empty map unless the scenario explicitly
      // provides one). The desktop runner does not call buildOverdueDueDateMap
      // here — only the LocalLedgerRepository.summary() call path does that.
      const parentId = when.parentId as string;
      const parentName = given.parent?.name ?? "Test Parent";
      const overdueMap = (when.overdueDueDates as Map<string, number>) ?? new Map();
      const summary = computeParentSummary(entries, parentId, parentName, overdueMap);
      return {
        totalOutstanding: summary.totalOutstanding,
        totalPaid: summary.totalPaid,
        totalCharged: summary.totalCharged,
        totalOverdue: summary.totalOverdue,
        totalCleared: summary.totalCleared,
        totalPending: summary.totalPending,
        totalUnallocatedCredit: summary.totalUnallocatedCredit,
        accounts: summary.accounts.map((acc) => ({
          accountId: acc.accountId,
          category: String(acc.category),
          studentId: acc.studentId,
          balance: acc.balance,
          unallocatedCredit: acc.unallocatedCredit,
          totalCharged: acc.totalCharged,
          totalPaid: acc.totalPaid,
          totalAdjusted: acc.totalAdjusted,
        })),
      };
    }

    case "allocatePayment": {
      const installments = (given.installments ?? []).map(toMirrorInstallment);
      const paymentAmount = when.paymentAmount as number;
      const category = when.category as string | null;
      const paymentStatus = (when.paymentStatus as "paid" | "pending") ?? "paid";
      const paymentId = (when.paymentId as string) ?? "pay-test";
      void paymentId;

      const result = allocatePaymentToInstallments(
        installments,
        paymentAmount,
        category ? (PaymentCategory_fromCode(category) as PaymentCategoryCode) : null,
        (paymentStatus as PaymentStatusCode) ?? "paid",
      );

      const installmentsAfter = installments.map((i) => {
        const alloc = result.allocations.find((a) => a.installmentId === i.id);
        if (!alloc) return i;
        return {
          ...i,
          amountPaid: alloc.newAmountPaid,
          amountPending: alloc.newAmountPending,
          status: alloc.newStatus,
        };
      });

      return {
        allocations: result.allocations.map((a) => ({
          installmentId: a.installmentId,
          allocatedAmount: a.allocatedAmount,
          newAmountPaid: a.newAmountPaid,
          newAmountPending: a.newAmountPending,
          newStatus: a.newStatus,
          fullySatisfied: a.fullySatisfied,
          cleared: a.cleared,
        })),
        unallocatedAmount: result.unallocatedAmount,
        totalAllocated: result.totalAllocated,
        paymentAmount: result.paymentAmount,
        installments: installmentsAfter.map((i) => ({
          id: i.id,
          amountPaid: i.amountPaid,
          amountPending: i.amountPending,
          status: i.status,
        })),
        totalPaid: installmentsAfter.reduce((s, i) => s + i.amountPaid, 0),
        totalPending: installmentsAfter.reduce((s, i) => s + i.amountPending, 0),
        totalOutstanding: installmentsAfter.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending), 0),
        totalUnallocatedCredit: result.unallocatedAmount > 0 ? -result.unallocatedAmount : 0,
      };
    }

    case "revertPaymentAllocation": {
      const installments = (given.installments ?? []).map(toMirrorInstallment);
      const reversalAmount = when.reversalAmount as number;
      const category = when.category as string | null;
      const originalWasPending = (when.originalWasPending as boolean) ?? false;

      const result = revertPaymentAllocation(
        installments,
        reversalAmount,
        category ? (PaymentCategory_fromCode(category) as PaymentCategoryCode) : null,
        originalWasPending,
      );

      const installmentsAfter = installments.map((i) => {
        const rev = result.reverts.find((r) => r.installmentId === i.id);
        if (!rev) return i;
        return {
          ...i,
          amountPaid: rev.newAmountPaid,
          amountPending: rev.newAmountPending,
          status: rev.newStatus,
        };
      });

      return {
        reverts: result.reverts.map((r) => ({
          installmentId: r.installmentId,
          revertedAmount: r.revertedAmount,
          newAmountPaid: r.newAmountPaid,
          newAmountPending: r.newAmountPending,
          newStatus: r.newStatus,
          reopened: r.reopened,
        })),
        totalReverted: result.totalReverted,
        unrevertedAmount: result.unrevertedAmount,
        reversalAmount: result.reversalAmount,
        installments: installmentsAfter.map((i) => ({
          id: i.id,
          amountPaid: i.amountPaid,
          amountPending: i.amountPending,
          status: i.status,
        })),
        totalPaid: installmentsAfter.reduce((s, i) => s + i.amountPaid, 0),
        totalPending: installmentsAfter.reduce((s, i) => s + i.amountPending, 0),
        totalOutstanding: installmentsAfter.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending), 0),
      };
    }

    case "evaluateAllSystemDiscounts": {
      const p = when.discountParams as {
        grossTuition: number;
        previousGradeLevel: string | null;
        currentGradeLevel: string;
        childIndex: number;
        paymentPlan: "full_annual" | "tranches";
        paymentDate: string;
        academicYearStartYear: number;
        academicYearStart: string;
        enrollmentDate: string;
        previousRank: number | null;
        siblingPerChildAmount?: number;
      };

      const evals = evaluateAllSystemDiscounts({
        grossTuition: p.grossTuition,
        previousGradeLevel: p.previousGradeLevel,
        currentGradeLevel: p.currentGradeLevel,
        childIndex: p.childIndex,
        paymentPlan: PaymentPlan_fromCode(p.paymentPlan) as PaymentPlanCode,
        paymentDate: p.paymentDate,
        academicYearStartYear: p.academicYearStartYear,
        academicYearStart: p.academicYearStart,
        enrollmentDate: p.enrollmentDate,
        previousRank: p.previousRank,
        siblingPerChildAmount: p.siblingPerChildAmount,
      });

      return {
        discountsApplied: evals.filter((e) => e.applied).map((e) => e.code),
        totalDiscount: sumDiscounts(evals),
        evaluations: evals.map((e) => ({
          code: e.code,
          label: e.label,
          amount: e.amount,
          applied: e.applied,
          reason: e.reason,
        })),
      };
    }

    case "reconcileLedger": {
      const includePayments = (when.includePayments as boolean) ?? false;
      const includeInstallments = (when.includeInstallments as boolean) ?? false;
      const includeParentSummaries = (when.includeParentSummaries as boolean) ?? false;

      const crossCheckInputs: CrossCheckInputs = {};

      if (includePayments) {
        const payments: PaymentCrossCheck[] = (given.payments ?? []).map((p) => ({
          id: p.id,
          amount: p.amount,
          status: (PaymentStatus_fromCode(p.status) ?? "pending") as PaymentStatusCode,
        }));
        crossCheckInputs.payments = payments;
      }

      if (includeInstallments) {
        const installments: InstallmentCrossCheck[] = (given.installments ?? []).map((i) => ({
          id: i.id,
          parentId: i.parentId,
          studentId: i.studentId,
          category: i.category,
          amountDue: i.amountDue,
          amountPaid: i.amountPaid,
          label: i.label,
          status: i.status,
        }));
        crossCheckInputs.installments = installments;
        const paymentToInstallmentId = new Map<string, string>();
        for (const p of (given.payments ?? [])) {
          if (p.installmentId) paymentToInstallmentId.set(p.id, p.installmentId);
        }
        crossCheckInputs.paymentToInstallmentId = paymentToInstallmentId;
      }

      if (includeParentSummaries && given.parent) {
        // Match desktop_runner.ts: no overdueMap
        const summary = computeParentSummary(entries, given.parent.id, given.parent.name);
        const parentSummaries: ParentSummaryCrossCheck[] = [{
          parentId: given.parent.id,
          parentName: given.parent.name,
          totalOutstanding: summary.totalOutstanding,
          accounts: summary.accounts.map((acc) => ({
            accountId: acc.accountId,
            category: String(acc.category),
            studentId: acc.studentId,
            balance: acc.balance,
            unallocatedCredit: acc.unallocatedCredit,
          })),
        }];
        crossCheckInputs.parentSummaries = parentSummaries;
      }

      const report = reconcileLedger(entries, crossCheckInputs);

      return {
        violations: report.violations.map((v) => ({
          severity: v.severity,
          code: v.code,
          message: v.message,
          details: v.details,
        })),
        violationCodes: report.violations.map((v) => v.code),
        pass: !report.violations.some((v) => v.severity === "ERROR"),
        errorCount: report.violations.filter((v) => v.severity === "ERROR").length,
        warningCount: report.violations.filter((v) => v.severity === "WARNING").length,
      };
    }

    case "syncRoundTrip": {
      const operations = (when.operations as Array<{
        type: string;
        paymentAmount?: number;
        category?: string;
        paymentStatus?: string;
        paymentId?: string;
        reversalAmount?: number;
        originalWasPending?: boolean;
      }>) ?? [];

      let installments = (given.installments ?? []).map(toMirrorInstallment);
      const entriesAfter = [...entries];

      for (const op of operations) {
        if (op.type === "allocatePayment") {
          const result = allocatePaymentToInstallments(
            installments,
            op.paymentAmount!,
            op.category ? (PaymentCategory_fromCode(op.category) as PaymentCategoryCode) : null,
            (op.paymentStatus as PaymentStatusCode) ?? "paid",
          );
          installments = installments.map((i) => {
            const alloc = result.allocations.find((a) => a.installmentId === i.id);
            if (!alloc) return i;
            return {
              ...i,
              amountPaid: alloc.newAmountPaid,
              amountPending: alloc.newAmountPending,
              status: alloc.newStatus,
            };
          });
        } else if (op.type === "revertPaymentAllocation") {
          const result = revertPaymentAllocation(
            installments,
            op.reversalAmount!,
            op.category ? (PaymentCategory_fromCode(op.category) as PaymentCategoryCode) : null,
            op.originalWasPending ?? false,
          );
          installments = installments.map((i) => {
            const rev = result.reverts.find((r) => r.installmentId === i.id);
            if (!rev) return i;
            return {
              ...i,
              amountPaid: rev.newAmountPaid,
              amountPending: rev.newAmountPending,
              status: rev.newStatus,
            };
          });
        }
      }

      const parentId = given.parent?.id ?? "par-001";
      const parentName = given.parent?.name ?? "Test Parent";
      // Match desktop_runner.ts: no overdueMap
      const summary = computeParentSummary(entriesAfter, parentId, parentName);

      return {
        installments: installments.map((i) => ({
          id: i.id,
          amountPaid: i.amountPaid,
          amountPending: i.amountPending,
          status: i.status,
        })),
        totalPaid: installments.reduce((s, i) => s + i.amountPaid, 0),
        totalPending: installments.reduce((s, i) => s + i.amountPending, 0),
        totalOutstanding: installments.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending), 0),
        totalCharged: summary.totalCharged,
        totalUnallocatedCredit: summary.totalUnallocatedCredit,
      };
    }

    default:
      return { error: `Unknown operation type: ${when.type}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

function loadScenarios(dirs: string[]): CanonicalScenario[] {
  const scenarios: CanonicalScenario[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(dir, file);
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const scenario = JSON.parse(content) as CanonicalScenario;
        scenarios.push(scenario);
      } catch (e) {
        console.error(`Failed to load ${fullPath}: ${(e as Error).message}`);
      }
    }
  }
  return scenarios;
}

function runAll(scenarios: CanonicalScenario[], outputDir: string): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let passed = 0;
  let failed = 0;
  let errored = 0;
  const results: Array<{ id: string; status: "pass" | "fail" | "error"; durationMs: number }> = [];

  for (const scenario of scenarios) {
    const start = Date.now();
    try {
      const result = runOperation(scenario);
      const durationMs = Date.now() - start;

      const outputFile = path.join(outputDir, `${scenario.id}.json`);
      const output = {
        scenarioId: scenario.id,
        engine: "android_mirror",
        engineVersion: "1.0.0",
        category: scenario.category,
        tags: scenario.tags ?? [],
        description: scenario.description,
        operationType: scenario.when.type,
        result,
        expected: scenario.then ?? {},
        durationMs,
        timestamp: new Date().toISOString(),
      };
      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

      if (result.error) {
        errored++;
        results.push({ id: scenario.id, status: "error", durationMs });
        console.error(`  ✗ ${scenario.id} — error: ${result.error}`);
      } else {
        passed++;
        results.push({ id: scenario.id, status: "pass", durationMs });
        console.log(`  ✓ ${scenario.id} (${durationMs}ms)`);
      }
    } catch (e) {
      const durationMs = Date.now() - start;
      errored++;
      results.push({ id: scenario.id, status: "error", durationMs });
      console.error(`  ✗ ${scenario.id} — exception: ${(e as Error).message}`);

      const outputFile = path.join(outputDir, `${scenario.id}.json`);
      fs.writeFileSync(outputFile, JSON.stringify({
        scenarioId: scenario.id,
        engine: "android_mirror",
        engineVersion: "1.0.0",
        category: scenario.category,
        operationType: scenario.when.type,
        result: { error: (e as Error).message },
        expected: scenario.then ?? {},
        durationMs,
        timestamp: new Date().toISOString(),
      }, null, 2));
    }
  }

  console.log("");
  console.log(`Android mirror runner: ${passed} passed, ${failed} failed, ${errored} errored (of ${scenarios.length} total)`);
  console.log(`Results written to: ${outputDir}`);

  const summaryFile = path.join(outputDir, "_summary.json");
  fs.writeFileSync(summaryFile, JSON.stringify({
    engine: "android_mirror",
    engineVersion: "1.0.0",
    ranAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    passed, failed, errored,
    results,
  }, null, 2));
}

// CLI entry point
const scriptDir = __dirname;
const rootDir = path.resolve(scriptDir, "..");
const scenariosDir = path.join(rootDir, "scenarios");
const generatedDir = path.join(rootDir, "generated");
const resultsDir = path.join(rootDir, "results", "android_mirror");

const args = process.argv.slice(2);
const includeGenerated = args.includes("--generated");
const specificFiles = args.filter((a) => !a.startsWith("--"));

let scenarios: CanonicalScenario[] = [];

if (specificFiles.length > 0) {
  for (const f of specificFiles) {
    const fullPath = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      scenarios.push(JSON.parse(content) as CanonicalScenario);
    } catch (e) {
      console.error(`Failed to load ${fullPath}: ${(e as Error).message}`);
    }
  }
} else {
  const dirs = [scenariosDir];
  if (includeGenerated) dirs.push(generatedDir);
  scenarios = loadScenarios(dirs);
}

console.log(`Android Mirror Equivalence Runner — ${scenarios.length} scenarios`);
console.log("=".repeat(60));
runAll(scenarios, resultsDir);
