/**
 * Shared types for the financial-repository subfolder.
 *
 * Extracted from `financial-repository.ts` in task 6-b. Behavior preserved
 * verbatim — only file location changed. The 4 mock repository classes
 * (`MockPaymentRepository` / `MockInstallmentRepository` /
 * `MockDebtRepository` / `MockExpenseRepository`) delegate their mutation
 * methods to plain-function op modules in this folder; those op functions
 * take the shared `MockStore` + helpers as parameters so the public class
 * API (and the singleton exports at the bottom of `financial-repository.ts`)
 * remains unchanged.
 */
import type { MockStore } from "../mock-store";

/**
 * Bundle of store + helpers passed to every op function. Mirrors the
 * free `store` / `appendAudit` / `nowIso` / `delay` / `TENANT_ID` imports
 * that the original class methods closed over.
 */
export interface FinancialOpsCtx {
  store: MockStore;
  appendAudit: (input: Parameters<typeof import("../mock-store").appendAudit>[0]) => void;
  nowIso: () => string;
  delay: (ms: number) => Promise<void>;
  tenantId: string;
}
