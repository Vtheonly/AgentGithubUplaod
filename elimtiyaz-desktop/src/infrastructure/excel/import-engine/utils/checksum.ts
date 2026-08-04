/**
 * SHA-256 checksums for files and objects.
 *
 * Ported from `excel-import-engine/src/utils/checksum.js`. Uses the Web
 * Crypto API (`crypto.subtle.digest`) which works in both the Electron
 * renderer and modern Node.js (≥ 16).
 *
 * The 16-char truncation for `objectChecksum` is intentional — it's a
 * change-detection digest, not a cryptographic hash. Truncating keeps
 * the SQLite `checksum` column size small and makes comparisons faster.
 */

/**
 * Compute the SHA-256 checksum of a file's bytes.
 *
 * Accepts a `Uint8Array` (or `ArrayBuffer`) since the renderer obtains
 * file bytes via `File.arrayBuffer()`. The original Node version accepted
 * a file path and read it synchronously — that pattern doesn't apply in
 * the renderer.
 */
export async function fileChecksum(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const hash = await sha256(bytes);
  return hash;
}

/**
 * Compute a 16-char truncated SHA-256 digest of a record object.
 *
 * Used for change detection during upsert — if the digest matches the
 * stored value, the record is skipped (no rewrite). The sorted-keys
 * replacer ensures deterministic output regardless of property insertion
 * order at the top level.
 */
export async function objectChecksum(obj: Record<string, unknown>): Promise<string> {
  const stable = JSON.stringify(obj, Object.keys(obj).sort());
  const encoder = new TextEncoder();
  const bytes = encoder.encode(stable);
  const hash = await sha256(bytes);
  return hash.slice(0, 16);
}

/**
 * Internal SHA-256 helper — wraps `crypto.subtle.digest` with a copy-into-
 * fresh-ArrayBuffer step to satisfy TypeScript 5.7's strict `BufferSource`
 * narrowing (which rejects `Uint8Array<ArrayBufferLike>` where the buffer
 * could theoretically be a `SharedArrayBuffer`).
 */
async function sha256(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  // Copy into a fresh ArrayBuffer — avoids the SharedArrayBuffer narrowing issue.
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
