/**
 * ID generators for the import engine.
 *
 * Ported from `excel-import-engine/src/utils/id.js`. Uses the Web Crypto
 * API (`crypto.randomUUID`) which is available in both the Electron
 * renderer and modern Node.js.
 */

/**
 * Generate a run ID of the form `run_<timestamp-base36>_<6-hex-random>`.
 * The timestamp makes runs sort chronologically; the random suffix
 * disambiguates runs that start in the same millisecond.
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `run_${timestamp}_${random}`;
}

/** Generate a UUID v4 using the Web Crypto API. */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old environments.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
