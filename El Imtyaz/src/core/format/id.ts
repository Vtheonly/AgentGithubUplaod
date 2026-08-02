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
