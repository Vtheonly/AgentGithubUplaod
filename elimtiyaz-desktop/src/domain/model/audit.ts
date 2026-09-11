/**
 * Audit log domain — plan §12.
 *
 * Universal action traceability. Append-only. Every state change writes a
 * complete `before_json` / `after_json` delta. Truncation forbidden.
 * Anonymous operations are strictly impossible — system actions attributed
 * to a system user ID.
 */
export interface AuditEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly actorId: string;
  readonly actorName: string;
  /**
   * VAULT §12.02 — actor role at the time of the action (part of the
   * contextual audit schema: actor_id, actor_name, role, action…).
   */
  readonly actorRole?: string | null;
  /**
   * VAULT §12.02 — session telemetry `{ ip, device, session_id }` captured
   * with every entry. Never truncated.
   */
  readonly sessionId?: string | null;
  readonly diff: string | null; // JSON diff { before, after }
  readonly note: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly at: string; // ISO timestamp
}

export interface AuditLogFilter {
  readonly action?: string | null;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly actorId?: string | null;
  readonly actorNameContains?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AuditLogQueryResult {
  readonly entries: readonly AuditEntry[];
  readonly total: number;
  readonly hasMore: boolean;
}

/* ------------------------------------------------------------------ */
/*  T-299 (OFFLINE-400) — the realtime attributed activity broadcast   */
/* ------------------------------------------------------------------ */

/**
 * One attributed activity event — the realtime projection of an
 * `audit_logs` INSERT, carrying exactly the mandate's attribution triple:
 * WHO (actor name + role + account id), WHAT (action), TARGET (entity
 * type + id). Emitted by the audit repositories on their realtime stream
 * (`observeActivity()`) — the desktop toaster + the Android audit stream
 * render it.
 */
export interface AttributedActivityEvent {
  readonly actorName: string;
  readonly actorRole: string | null;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly occurredAt: string;
}

/** Compact id for toasts/feeds (UUIDs render truncated). */
function shortId(entityId: string): string {
  if (entityId.length <= 12) return entityId || "—";
  return `${entityId.slice(0, 8)}…`;
}

/**
 * Format the attributed sentence — the mandate's example shape
 * "Yacine Benali (Finance) updated payment status … for Parent PAR-2026-A12",
 * localized French:
 *   title: the actor + role chip
 *   body:  "<Name> (<Role>) — <action> · <entityType> <shortId>"
 * A null role renders honestly ("rôle non enregistré" is the drawer's
 * wording; the toast omits the parenthesis instead — no fabrication).
 */
export function formatAttributedActivity(event: AttributedActivityEvent): {
  title: string;
  body: string;
} {
  const who = event.actorRole
    ? `${event.actorName} (${event.actorRole})`
    : event.actorName || "Système";
  const target = `${event.entityType} ${shortId(event.entityId)}`.trim();
  return {
    title: `Activité — ${who}`,
    body: `${who} — ${event.action} · ${target}`,
  };
}

/**
 * T-299: the subscribe-only contract for the attributed-activity EVENT
 * stream (an event flow, not a state observable — `Observable<T>`'s
 * `get()` has no meaning for fire-once events).
 */
export interface AttributedActivityStream {
  subscribe(fn: (event: AttributedActivityEvent) => void): () => void;
}
