// ============================================================================
// FILE: src/features/settings/supabase-diagnostics/index.ts
// ============================================================================
/**
 * T-393 — public surface of the Supabase diagnostics module.
 * Self-contained: importing this module pulls in no shared-component edits
 * and no i18n dictionary (the T-388 concurrent-agent safety contract).
 *
 * T-396 — the CRUD integration test surface joins the family (same module,
 * same conventions: the read-only diagnostics tab stays untouched).
 */
export { SupabaseDiagnosticsTab } from "./supabase-diagnostics-tab";
export { runSupabaseDiagnostics, expectedCheckCount, formatDiagnosticsReportText } from "./diagnostics-runner";
export { CrudTestTab } from "./crud-test-tab";
export { runCrudIntegrationTests, expectedCrudCheckCount } from "./crud-test-runner";
export type { CrudProbeIdentity } from "./crud-test-runner";
export type {
  DiagnosticCheck,
  DiagnosticsReport,
  DiagnosticsRunOptions,
  DiagnosticsSummary,
  DomainSessionInfo,
  CheckStatus,
} from "./diagnostics-types";
export { STATUS_LABELS } from "./diagnostics-types";
