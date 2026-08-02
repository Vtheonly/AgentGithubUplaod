/**
 * Reconciliation types — shared between the orchestrator and individual checks.
 *
 * Kept in a separate file from `reconcile/index.ts` to avoid circular
 * imports: `checks.ts` imports these types, and `reconcile/index.ts`
 * imports `checks.ts`.
 */

export type ReconciliationSeverity = "error" | "warning" | "info";

export interface ReconciliationViolation {
  readonly severity: ReconciliationSeverity;
  readonly code: string;
  readonly message: string;
  readonly entryId?: string;
  readonly accountId?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ReconciliationReport {
  readonly checkedAt: string;
  readonly entryCount: number;
  readonly accountCount: number;
  readonly violations: readonly ReconciliationViolation[];
  readonly passed: boolean;
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
  };
}
