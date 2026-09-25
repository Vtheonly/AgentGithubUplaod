/**
 * Payroll calculation module — public barrel.
 *
 * Submodules:
 *   - `payroll-forecast` — computePayrollForecast + period helpers: the ONE
 *     canonical personnel payroll cash-flow forecast (T-412 / ADR-024),
 *     consumed by Personnel (operational), Finance (cash-management) and
 *     Statistics (planning). Never re-implemented page-locally.
 */
export * from "./payroll-forecast";
