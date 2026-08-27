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

/** Generate a 4-char random suffix for parent codes. */
export function randomParentSuffix(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
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
