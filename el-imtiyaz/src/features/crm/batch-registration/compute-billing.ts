/**
 * Hoisted helper for type inference in step 3 / step 4 props.
 *
 * This function is only used for type inference; the actual computation is
 * in the useMemo inside the BatchRegistrationModal orchestrator.
 *
 * Imported by the orchestrator and re-exported so that step components can
 * use `Billing` directly — but kept here for backward-compat with any code
 * that referenced `ReturnType<typeof computeBilling>`.
 */
import type { Billing, BillingInput } from "./types";

export function computeBilling(_input: BillingInput): Billing {
  return null as unknown as Billing;
}
