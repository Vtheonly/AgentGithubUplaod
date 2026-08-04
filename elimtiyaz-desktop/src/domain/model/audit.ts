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
