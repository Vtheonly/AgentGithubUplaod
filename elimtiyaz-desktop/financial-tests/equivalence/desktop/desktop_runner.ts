/**
 * Cross-Platform Equivalence Test Runner — Desktop (TypeScript).
 *
 * Reads canonical JSON scenarios from `scenarios/` (and optionally
 * `generated/`), runs each through the desktop's canonical financial
 * engine, captures the complete domain result, and writes a normalized
 * JSON result file to `results/desktop/<scenario_id>.json`.
 *
 * The Android runner (`android/AndroidEquivalenceRunner.kt`) reads the
 * SAME scenarios and writes results to `results/android/<scenario_id>.json`.
 * The comparator (`comparison/comparator.ts`) then compares the two sets.
 *
 * All monetary values are normalized to CENTIMES (Long) in the output.
 * The desktop's internal `number` (DZD) representation is converted via
 * `Math.round(amount * 100)` to preserve centime precision without
 * floating-point drift.
 *
 * Usage:
 *   npx tsx desktop/desktop_runner.ts                       # run all scenarios
 *   npx tsx desktop/desktop_runner.ts scenarios/001_*.json   # run specific
 *   npx tsx desktop/desktop_runner.ts --generated           # also run generated
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  computeAccountBalance,
  computeParentSummary,
} from "../../../src/domain/calc/ledger/balance";
import {
  allocatePaymentToInstallments,
} from "../../../src/domain/calc/payment/waterfall-allocator";
import {
  revertPaymentAllocation,
} from "../../../src/domain/calc/payment/lifo-reversal";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
} from "../../../src/domain/calc/pricing/discount-engine";
import { reconcileLedger } from "../../../src/domain/calc/reconcile";
import {
  crossCheckBalanceSum,
  crossCheckPayments,
  crossCheckInstallments,
  crossCheckInstallmentPayments,
  crossCheckClearedBalance,
  crossCheckParentCredit,
} from "../../../src/domain/calc/reconcile/cross-checks";
import type { LedgerEntry } from "../../../src/domain/model/ledger";

// ───────────────────────────────────────────────────────────────────────────
// Types — mirror the canonical JSON scenario schema. Single source of truth
// for what the desktop runner expects as input.
// ───────────────────────────────────────────────────────────────────────────

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

// ───────────────────────────────────────────────────────────────────────────
// Conversions — canonical JSON (centimes) ↔ desktop internal (DZD).
//
// The desktop's canonical engine uses JS `number` for amounts in DZD.
// The canonical JSON scenario format uses centimes (Long) to avoid
// cross-language floating-point drift. We convert on input and output.
// ───────────────────────────────────────────────────────────────────────────

const CENTIMES_PER_DZD = 100;

/** Convert centimes (Long) → DZD (number). The desktop engine's internal unit. */
function centimesToDzd(centimes: number): number {
  return centimes / CENTIMES_PER_DZD;
}

/** Convert DZD (number) → centimes (Long) for output normalization. */
function dzdToCentimes(dzd: number): number {
  return Math.round(dzd * CENTIMES_PER_DZD);
}

/** Convert a canonical ledger entry (centimes) → desktop LedgerEntry (DZD). */
function toDesktopLedgerEntry(e: CanonicalLedgerEntry): LedgerEntry {
  return {
    id: e.id,
    tenantId: "t1",   // canonical scenarios always use t1
    accountId: deriveAccountIdDesktop(e.parentId, e.category, e.studentId),
    parentId: e.parentId,
    studentId: e.studentId,
    category: e.category as LedgerEntry["category"],
    amount: centimesToDzd(e.amount),
    type: e.type as LedgerEntry["type"],
    sourceType: e.sourceType as LedgerEntry["sourceType"],
    sourceId: e.sourceId,
    method: (e.method ?? undefined) as LedgerEntry["method"],
    receiptNumber: e.receiptNumber ?? undefined,
    paymentStatus: (e.paymentStatus ?? undefined) as LedgerEntry["paymentStatus"],
    reversesId: e.reversesId ?? undefined,
    description: e.description,
    actorId: e.actorId,
    actorName: e.actorName,
    at: e.at,
    metadata: e.metadata ?? {},
  };
}

/** Mirror of `deriveAccountId` — pure string concat, no I/O. */
function deriveAccountIdDesktop(parentId: string, category: string, studentId: string | null): string {
  const parts = ["parent", parentId, "category", category];
  if (studentId) { parts.push("student", studentId); }
  return parts.join(":");
}

/** Convert a canonical installment (centimes) → desktop WaterfallInstallment (DZD). */
interface WaterfallInstallment {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  amountDue: number;
  amountPaid: number;
  amountPending: number;
  dueDate: string;
  status: string;
  label: string;
}

function toDesktopInstallment(i: CanonicalInstallment): WaterfallInstallment {
  return {
    id: i.id,
    parentId: i.parentId,
    studentId: i.studentId,
    category: i.category,
    amountDue: centimesToDzd(i.amountDue),
    amountPaid: centimesToDzd(i.amountPaid),
    amountPending: centimesToDzd(i.amountPending),
    dueDate: i.dueDate,
    status: i.status,
    label: i.label,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Operation dispatch — runs the scenario's `when` operation through the
// canonical desktop engine and returns the result.
// ───────────────────────────────────────────────────────────────────────────

interface OperationResult {
  // The complete post-operation state, normalized to centimes.
  totalOutstanding?: number;
  totalPaid?: number;
  totalCharged?: number;
  totalOverdue?: number;
  totalCleared?: number;
  totalPending?: number;
  totalUnallocatedCredit?: number;
  balance?: number;
  totalAdjusted?: number;
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
  pass?: boolean;
  errorCount?: number;
  warningCount?: number;
  discountsApplied?: string[];
  totalDiscount?: number;
  allocations?: Array<{
    installmentId: string;
    amountAllocated: number;
    bucket: string;   // "paid" | "pending"
  }>;
  unallocatedAmount?: number;
  allocatedAmount?: number;
  errorExpected?: boolean;
  error?: string;
}

function runOperation(scenario: CanonicalScenario): OperationResult {
  const given = scenario.given;
  const when = scenario.when;
  const entries = given.ledgerEntries.map(toDesktopLedgerEntry);

  switch (when.type) {
    case "computeAccountBalance": {
      const accountId = when.accountId as string;
      const bal = computeAccountBalance(entries, accountId);
      return {
        balance: dzdToCentimes(bal.balance),
        totalCharged: dzdToCentimes(bal.totalCharged),
        totalPaid: dzdToCentimes(bal.totalPaid),
        totalAdjusted: dzdToCentimes(bal.totalAdjusted),
        unallocatedCredit: dzdToCentimes(bal.unallocatedCredit ?? 0),
        totalRefunded: dzdToCentimes(bal.totalRefunded ?? 0),
        totalCleared: dzdToCentimes(bal.totalCleared ?? 0),
        totalPending: dzdToCentimes(bal.totalPending ?? 0),
      };
    }

    case "computeParentSummary": {
      const parentId = when.parentId as string;
      const parentName = given.parent?.name ?? "Test Parent";
      const summary = computeParentSummary(entries, parentId, parentName);
      return {
        totalOutstanding: dzdToCentimes(summary.totalOutstanding),
        totalPaid: dzdToCentimes(summary.totalPaid),
        totalCharged: dzdToCentimes(summary.totalCharged),
        totalOverdue: dzdToCentimes(summary.totalOverdue),
        totalCleared: dzdToCentimes(summary.totalCleared),
        totalPending: dzdToCentimes(summary.totalPending),
        totalUnallocatedCredit: dzdToCentimes(summary.totalUnallocatedCredit),
        accounts: summary.accounts.map((acc) => ({
          accountId: acc.accountId,
          category: String(acc.category),
          studentId: acc.studentId,
          balance: dzdToCentimes(acc.balance),
          unallocatedCredit: dzdToCentimes(acc.unallocatedCredit ?? 0),
          totalCharged: dzdToCentimes(acc.totalCharged),
          totalPaid: dzdToCentimes(acc.totalPaid),
          totalAdjusted: dzdToCentimes(acc.totalAdjusted),
        })),
      };
    }

    case "allocatePayment": {
      const installments = (given.installments ?? []).map(toDesktopInstallment);
      const paymentAmount = centimesToDzd(when.paymentAmount as number);
      const category = when.category as string;
      const paymentStatus = when.paymentStatus as "paid" | "pending";
      const paymentId = (when.paymentId as string) ?? "pay-test";
      void paymentId;

      const result = allocatePaymentToInstallments(
        installments,
        paymentAmount,
        category as never,
        paymentStatus,
      );

      // Apply the allocation to a working copy of installments so we can
      // report the post-allocation state.
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
          allocatedAmount: dzdToCentimes(a.allocatedAmount),
          newAmountPaid: dzdToCentimes(a.newAmountPaid),
          newAmountPending: dzdToCentimes(a.newAmountPending),
          newStatus: a.newStatus,
          fullySatisfied: a.fullySatisfied,
          cleared: a.cleared,
        })),
        unallocatedAmount: dzdToCentimes(result.unallocatedAmount),
        totalAllocated: dzdToCentimes(result.totalAllocated),
        paymentAmount: dzdToCentimes(result.paymentAmount),
        installments: installmentsAfter.map((i) => ({
          id: i.id,
          amountPaid: dzdToCentimes(i.amountPaid),
          amountPending: dzdToCentimes(i.amountPending),
          status: i.status,
        })),
        totalPaid: dzdToCentimes(installmentsAfter.reduce((s, i) => s + i.amountPaid, 0)),
        totalPending: dzdToCentimes(installmentsAfter.reduce((s, i) => s + i.amountPending, 0)),
        totalOutstanding: dzdToCentimes(
          installmentsAfter.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending), 0),
        ),
        totalUnallocatedCredit: result.unallocatedAmount > 0
          ? -dzdToCentimes(result.unallocatedAmount)
          : 0,
      };
    }

    case "revertPaymentAllocation": {
      const installments = (given.installments ?? []).map(toDesktopInstallment);
      const reversalAmount = centimesToDzd(when.reversalAmount as number);
      const category = when.category as string;
      const originalWasPending = when.originalWasPending as boolean;

      const result = revertPaymentAllocation(
        installments,
        reversalAmount,
        category as never,
        originalWasPending,
      );

      // `revertPaymentAllocation` returns `reverts: RevertAllocation[]`,
      // where each entry carries `installmentId`, `revertedAmount`,
      // `newAmountPaid`, `newAmountPending`, `newStatus`, `reopened`.
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
          revertedAmount: dzdToCentimes(r.revertedAmount),
          newAmountPaid: dzdToCentimes(r.newAmountPaid),
          newAmountPending: dzdToCentimes(r.newAmountPending),
          newStatus: r.newStatus,
          reopened: r.reopened,
        })),
        totalReverted: dzdToCentimes(result.totalReverted),
        unrevertedAmount: dzdToCentimes(result.unrevertedAmount),
        reversalAmount: dzdToCentimes(result.reversalAmount),
        installments: installmentsAfter.map((i) => ({
          id: i.id,
          amountPaid: dzdToCentimes(i.amountPaid),
          amountPending: dzdToCentimes(i.amountPending),
          status: i.status,
        })),
        totalPaid: dzdToCentimes(installmentsAfter.reduce((s, i) => s + i.amountPaid, 0)),
        totalPending: dzdToCentimes(installmentsAfter.reduce((s, i) => s + i.amountPending, 0)),
        totalOutstanding: dzdToCentimes(
          installmentsAfter.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending), 0),
        ),
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
        grossTuition: centimesToDzd(p.grossTuition),
        previousGradeLevel: p.previousGradeLevel as never,
        currentGradeLevel: p.currentGradeLevel as never,
        childIndex: p.childIndex,
        paymentPlan: p.paymentPlan,
        paymentDate: p.paymentDate,
        academicYearStartYear: p.academicYearStartYear,
        academicYearStart: p.academicYearStart,
        enrollmentDate: p.enrollmentDate,
        previousRank: p.previousRank,
        siblingPerChildAmount: p.siblingPerChildAmount !== undefined
          ? centimesToDzd(p.siblingPerChildAmount)
          : undefined,
      });

      return {
        discountsApplied: evals.filter((e) => e.applied).map((e) => e.code),
        totalDiscount: dzdToCentimes(sumDiscounts(evals)),
        evaluations: evals.map((e) => ({
          code: e.code,
          label: e.label,
          amount: dzdToCentimes(e.amount),
          applied: e.applied,
          reason: e.reason,
        })),
      };
    }

    case "reconcileLedger": {
      const includePayments = (when.includePayments as boolean) ?? false;
      const includeInstallments = (when.includeInstallments as boolean) ?? false;
      const includeParentSummaries = (when.includeParentSummaries as boolean) ?? false;

      const report = reconcileLedger(entries);

      // Run the additional cross-checks if requested.
      const extraViolations: Array<{ severity: string; code: string; message: string; details?: unknown }> = [];

      // Always run crossCheckBalanceSum (it only needs entries).
      const accountIds = new Set(entries.map((e) => e.accountId));
      const balances = Array.from(accountIds).map((accId) => computeAccountBalance(entries, accId));
      extraViolations.push(...crossCheckBalanceSum(entries, balances).map((v) => ({
        severity: v.severity, code: v.code, message: v.message, details: v.details as unknown,
      })));

      if (includePayments) {
        const payments = (given.payments ?? []).map((p) => ({
          id: p.id, amount: centimesToDzd(p.amount), status: p.status,
          receiptNumber: p.receiptNumber,
        }));
        extraViolations.push(...crossCheckPayments(payments, entries).map((v) => ({
          severity: v.severity, code: v.code, message: v.message, details: v.details as unknown,
        })));
        extraViolations.push(...crossCheckClearedBalance(payments, entries).map((v) => ({
          severity: v.severity, code: v.code, message: v.message, details: v.details as unknown,
        })));
      }

      if (includeInstallments) {
        const installments = (given.installments ?? []).map((i) => ({
          id: i.id, parentId: i.parentId, studentId: i.studentId,
          category: i.category, amountDue: centimesToDzd(i.amountDue),
          amountPaid: centimesToDzd(i.amountPaid),
          label: i.label, status: i.status,
        }));
        const paymentToInstallmentId = new Map<string, string>();
        for (const p of (given.payments ?? [])) {
          if (p.installmentId) paymentToInstallmentId.set(p.id, p.installmentId);
        }
        extraViolations.push(...crossCheckInstallments(installments, entries).map((v) => ({
          severity: v.severity, code: v.code, message: v.message, details: v.details as unknown,
        })));
        extraViolations.push(...crossCheckInstallmentPayments(installments, entries, paymentToInstallmentId).map((v) => ({
          severity: v.severity, code: v.code, message: v.message, details: v.details as unknown,
        })));
      }

      if (includeParentSummaries && given.parent) {
        const parentSummaries = [{
          parentId: given.parent.id,
          parentName: given.parent.name,
          totalOutstanding: computeParentSummary(entries, given.parent.id, given.parent.name).totalOutstanding,
          accounts: computeParentSummary(entries, given.parent.id, given.parent.name).accounts.map((acc) => ({
            accountId: acc.accountId, category: acc.category, studentId: acc.studentId,
            balance: acc.balance, unallocatedCredit: acc.unallocatedCredit ?? 0,
          })),
        }];
        extraViolations.push(...crossCheckParentCredit(parentSummaries, entries).map((v) => ({
          severity: v.severity, code: v.code, message: v.message, details: v.details as unknown,
        })));
      }

      const allViolations = [
        ...report.violations.map((v) => ({
          severity: String(v.severity), code: v.code, message: v.message,
        })),
        ...extraViolations,
      ];

      return {
        violations: allViolations,
        pass: !allViolations.some((v) => v.severity === "error"),
        errorCount: allViolations.filter((v) => v.severity === "error").length,
        warningCount: allViolations.filter((v) => v.severity === "warning").length,
        violationCodes: allViolations.map((v) => v.code),
      };
    }

    case "syncRoundTrip": {
      // Complex operation sequence — apply each operation in order.
      const operations = (when.operations as Array<{
        type: string;
        paymentAmount?: number;
        category?: string;
        paymentStatus?: string;
        paymentId?: string;
        reversalAmount?: number;
        originalWasPending?: boolean;
      }>) ?? [];

      let installments = (given.installments ?? []).map(toDesktopInstallment);
      const entriesAfter = [...entries];

      for (const op of operations) {
        if (op.type === "allocatePayment") {
          const result = allocatePaymentToInstallments(
            installments,
            centimesToDzd(op.paymentAmount!),
            op.category as never,
            op.paymentStatus as "paid" | "pending",
          );
          // Apply allocations back to installments.
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
            centimesToDzd(op.reversalAmount!),
            op.category as never,
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

      // Compute final summary via canonical engine.
      const parentId = given.parent?.id ?? "par-001";
      const parentName = given.parent?.name ?? "Test Parent";
      const summary = computeParentSummary(entriesAfter, parentId, parentName);

      return {
        installments: installments.map((i) => ({
          id: i.id,
          amountPaid: dzdToCentimes(i.amountPaid),
          amountPending: dzdToCentimes(i.amountPending),
          status: i.status,
        })),
        totalPaid: dzdToCentimes(installments.reduce((s, i) => s + i.amountPaid, 0)),
        totalPending: dzdToCentimes(installments.reduce((s, i) => s + i.amountPending, 0)),
        totalOutstanding: dzdToCentimes(
          installments.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending), 0),
        ),
        totalCharged: dzdToCentimes(summary.totalCharged),
        totalUnallocatedCredit: dzdToCentimes(summary.totalUnallocatedCredit),
      };
    }

    default:
      return { error: `Unknown operation type: ${when.type}` };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main — read scenarios, run each, write results.
// ───────────────────────────────────────────────────────────────────────────

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
        engine: "desktop",
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

      // Still write the error result so the comparator can see it.
      const outputFile = path.join(outputDir, `${scenario.id}.json`);
      fs.writeFileSync(outputFile, JSON.stringify({
        scenarioId: scenario.id,
        engine: "desktop",
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
  console.log(`Desktop runner: ${passed} passed, ${failed} failed, ${errored} errored (of ${scenarios.length} total)`);
  console.log(`Results written to: ${outputDir}`);

  // Write a summary file.
  const summaryFile = path.join(outputDir, "_summary.json");
  fs.writeFileSync(summaryFile, JSON.stringify({
    engine: "desktop",
    engineVersion: "1.0.0",
    ranAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    passed, failed, errored,
    results,
  }, null, 2));
}

// ───────────────────────────────────────────────────────────────────────────
// CLI entry point.
// ───────────────────────────────────────────────────────────────────────────

const scriptDir = __dirname;
const rootDir = path.resolve(scriptDir, "..");
const scenariosDir = path.join(rootDir, "scenarios");
const generatedDir = path.join(rootDir, "generated");
const resultsDir = path.join(rootDir, "results", "desktop");

const args = process.argv.slice(2);
const includeGenerated = args.includes("--generated");
const specificFiles = args.filter((a) => !a.startsWith("--"));

let scenarios: CanonicalScenario[] = [];

if (specificFiles.length > 0) {
  // Run only the specified files.
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
  // Run all scenarios in scenarios/ (+ generated/ if --generated).
  const dirs = [scenariosDir];
  if (includeGenerated) dirs.push(generatedDir);
  scenarios = loadScenarios(dirs);
}

console.log(`Desktop Equivalence Runner — ${scenarios.length} scenarios`);
console.log("=".repeat(60));
runAll(scenarios, resultsDir);
