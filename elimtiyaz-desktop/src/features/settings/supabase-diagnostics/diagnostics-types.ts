// ============================================================================
// FILE: src/features/settings/supabase-diagnostics/diagnostics-types.ts
// ============================================================================
/**
 * T-393 — the deterministic Supabase diagnostics screen (handed-over Task 21).
 *
 * Type contracts shared by the runner and the view. The runner produces a
 * DiagnosticsReport; the view renders it. Every check carries ONLY safe
 * detail strings (HTTP status + Supabase/Postgres error code + operation +
 * table) — NEVER keys, tokens, or JWTs (the describeSupabaseConnection()
 * convention).
 *
 * The status vocabulary is exactly the handed-over contract:
 *   PASS | FAIL | NOT TESTED
 */

/** The handed-over Task 21 status vocabulary. */
export type CheckStatus = "pass" | "fail" | "not_tested";

/** One deterministic probe result. */
export interface DiagnosticCheck {
  /** Stable machine id, e.g. "auth.sdk-session", "rls.parents". */
  id: string;
  /** French category heading, e.g. "Authentification". */
  category: string;
  /** French label of the individual probe, e.g. "Session Supabase (getSession)". */
  label: string;
  /** PASS | FAIL | NOT TESTED. */
  status: CheckStatus;
  /**
   * SAFE detail — HTTP status, error code, operation and table only.
   * Never contains keys, tokens, JWTs or session secrets.
   */
  detail: string;
  /** Probe duration in milliseconds (null when not executed). */
  durationMs: number | null;
}

/** Roll-up counts. */
export interface DiagnosticsSummary {
  pass: number;
  fail: number;
  notTested: number;
}

/** The full run output. */
export interface DiagnosticsReport {
  /** Epoch ms of the run. */
  ranAt: number;
  /** Ordered checks (the deterministic probe sequence order). */
  checks: DiagnosticCheck[];
  summary: DiagnosticsSummary;
}

/**
 * The minimal domain-session shape the AUTH-302 cross-check needs
 * (the app session from useAuth — userId/email only, never tokens).
 */
export interface DomainSessionInfo {
  userId: string;
  email: string;
}

/** Options for the runner. */
export interface DiagnosticsRunOptions {
  /** The canonical singleton client (getSupabaseClient()) — or null when unconfigured. */
  client: import("@supabase/supabase-js").SupabaseClient | null;
  /** The current app/domain session (useAuth().session) — null when signed out. */
  domainSession: DomainSessionInfo | null;
  /** Websocket subscribe timeout for the realtime probe (default 5000 ms). */
  realtimeTimeoutMs?: number;
}

/** French display names for the three statuses. */
export const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  not_tested: "NON TESTÉ",
};
