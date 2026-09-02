/**
 * ID / Code formatters — matches the Android app's code prefix conventions.
 *
 *   Parent code   → PAR-{year}-{4-char suffix}    e.g. PAR-2025-A4F9
 *   Student code  → ELV-{year}-{6-digit seq}       e.g. ELV-2025-001234
 *   Receipt #     → REC-{year}-{6-digit seq}       e.g. REC-2025-000123
 *   Personnel ID  → EMP-{year}-{3-digit seq}       e.g. EMP-2025-014
 *   Backup file   → backup-YYYY-MM-DD-HHMMSS.db
 */
export function parentCode(year: number, suffix: string): string {
  return `PAR-${year}-${suffix.toUpperCase()}`;
}

export function studentCode(year: number, seq: number): string {
  return `ELV-${year}-${String(seq).padStart(6, "0")}`;
}

export function receiptCode(year: number, seq: number): string {
  return `REC-${year}-${String(seq).padStart(6, "0")}`;
}

export function personnelCode(year: number, seq: number): string {
  return `EMP-${year}-${String(seq).padStart(3, "0")}`;
}

export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`
  );
}

/** Generate a 6-7 digit numeric activation code (plan §02). */
export function activationCode(): string {
  return String(Math.floor(100_000 + Math.random() * 9_000_000));
}

/**
 * Deterministic activation code — VAULT §02.08 (Account Activation Protocol).
 *
 * Mirrors the Android app's `IdentityCodes.deterministicActivationCode`:
 * FNV-1a over `"{tenantId}|{parentCode}"`, mapped into the 6-digit range
 * [100000, 999999] (a valid subset of the vault's "6 or 7 digits" rule).
 *
 * Deterministic codes keep the protocol idempotent across platforms:
 *   - Desktop passes the code to `upsert_parent_from_import(p_activation_code)`
 *     (migration 0037) exactly like Android does, so re-imports and re-runs
 *     converge on the SAME code instead of issuing a new one each time.
 *   - The single-use guarantee is enforced server-side by
 *     `activation_codes` (UNIQUE per tenant) + `bind_activation_code()` RPC.
 */
export function deterministicActivationCode(parentCode: string, tenantId: string = ""): string {
  const identity = `${tenantId}|${parentCode}`.trim();
  if (identity.length === 0) return "000000";
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < identity.length; i++) {
    h = (h ^ identity.charCodeAt(i)) | 0;
    h = Math.imul(h, 0x01000193) | 0;
  }
  const unsigned = h >>> 0;
  const numeric = (unsigned % 900_000) + 100_000;
  return numeric.toString();
}


// ============================================================================
// T-018 (DRIFT-001 / ADR-003) — deterministic identity-code generators.
// Canonical home (moved from infrastructure/supabase/repositories/
// supabase-shared-repositories.ts so the sync layer + import path share ONE
// implementation).
// ============================================================================

export interface ParentIdentityInput {
  phone?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface StudentIdentityInput {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Compute a short stable hash (6 hex chars) from an arbitrary string.
 * Used to derive deterministic parent/student codes from identity fields
 * (phone, display name) so that re-importing the same Excel row produces
 * the SAME code, letting the `upsert_*_from_import` RPCs hit their primary
 * identity match (tenant_id, parent_code) / (tenant_id, student_code)
 * instead of falling through to weaker fallbacks.
 *
 * Implementation: FNV-1a 32-bit, hex-encoded, truncated to 6 chars.
 * Not cryptographic — the goal is determinism + low collision rate across
 * a few thousand parents/students, which FNV-1a easily achieves.
 */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned 32-bit and encode as 8-char hex, take first 6.
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6).toUpperCase();
}

/**
 * Derive a deterministic parent code from the parent's identity fields.
 * The code is `PAR-{year}-{6-hex}` where the hex is a stable hash of
 * (primary_phone || display_name || first_name+last_name).
 *
 * Re-importing the same Excel row produces the same code → the
 * `upsert_parent_from_import` RPC's primary identity match
 * `(tenant_id, parent_code)` succeeds → idempotent upsert, no duplicates.
 */
export function deterministicParentCode(
  year: number,
  input: ParentIdentityInput,
  fallbackSeed?: string,
): string {
  // CANONICAL (cross-platform equivalence fix): filter out BOTH null and EMPTY
  // identity fields (after per-field trim) before joining. Previously empty
  // strings were joined while Android's listOfNotNull skipped them, so the
  // same parent produced different parent_codes on each platform — breaking
  // the idempotent (tenant_id, parent_code) upsert match.
  const identity = [
    input.phone ?? "",
    input.displayName ?? "",
    input.firstName ?? "",
    input.lastName ?? "",
  ]
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .join("|");
  // T-018: NO random fallback — with no identity fields the caller MUST
  // supply a stable seed (e.g. the sync entry id) so RETRIES converge on the
  // same code; a random suffix would create a duplicate parent server-side
  // on the second attempt (the dedup match IS the code).
  const suffix = identity.length > 0
    ? stableHash(identity)
    : stableHash(fallbackSeed ?? "orphan-parent");
  return `PAR-${year}-${suffix}`;
}

/**
 * Derive a deterministic student code from (parentId, student display name).
 * Re-importing the same Excel row produces the same code → primary identity
 * match `(tenant_id, student_code)` succeeds → idempotent upsert.
 */
export function deterministicStudentCode(
  year: number,
  parentId: string,
  input: StudentIdentityInput,
  fallbackSeed?: string,
): string {
  const identity = [
    parentId ?? "",
    input.displayName ?? "",
    input.firstName ?? "",
    input.lastName ?? "",
  ].join("|").trim();
  // T-018: NO random fallback — see deterministicParentCode.
  const suffix = identity.length > 0
    ? stableHash(identity)
    : stableHash(fallbackSeed ?? "orphan-student");
  return `ELV-${year}-${suffix}`;
}

