/**
 * AES-256-GCM service — Web Crypto API wrapper for the backup vault.
 *
 * Plan §13.02: every backup archive is encrypted with AES-256-GCM
 * (authenticated encryption). The 256-bit key is derived from a passphrase
 * via PBKDF2 (100,000 iterations) and a per-tenant salt.
 *
 * Never use CBC or CTR without a separate MAC — GCM provides both
 * confidentiality and integrity in a single primitive, and the Web Crypto
 * API verifies the GCM auth tag automatically on decrypt.
 */
import { BACKUP_PBKDF2_ITERATIONS } from "../../domain/model/backup";

/** PBKDF2 iteration count — exported for tests. */
export const PBKDF2_ITERATIONS = BACKUP_PBKDF2_ITERATIONS;

/** AES-GCM IV length — 12 bytes per NIST SP 800-38D. */
export const GCM_IV_LENGTH = 12;

/** AES-256 key length — 256 bits = 32 bytes. */
export const AES_256_KEY_LENGTH = 256;

/**
 * Derive an AES-256-GCM CryptoKey from a passphrase + salt via PBKDF2.
 *
 * The key is marked non-extractable so it can never be exported back out
 * of the Web Crypto subsystem (defense-in-depth: even an XSS that grabs
 * the CryptoKey object cannot recover the raw key bytes).
 */
export async function generateKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  if (!passphrase || passphrase.length === 0) {
    throw new Error("Backup passphrase must not be empty");
  }
  if (salt.length < 16) {
    throw new Error("Salt must be at least 16 bytes");
  }

  const subtle = ensureSubtle();
  // Import the passphrase as raw key material for PBKDF2.
  const baseKey = await subtle.importKey(
    "raw",
    encodeUtf8(passphrase) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  // Derive a non-extractable AES-256-GCM key.
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: AES_256_KEY_LENGTH },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext byte array with AES-256-GCM.
 *
 * Generates a fresh random 12-byte IV per call (never reuse an IV with the
 * same key — reusing an IV with GCM is catastrophic for confidentiality).
 *
 * Returns { ciphertext, iv } — the IV is stored alongside the ciphertext
 * (it is not secret) and is required for decryption.
 */
export async function encrypt(
  plaintext: Uint8Array,
  key: CryptoKey,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const subtle = ensureSubtle();
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH));
  const cipherBuf = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 },
    key,
    plaintext as BufferSource,
  );
  return { ciphertext: new Uint8Array(cipherBuf), iv };
}

/**
 * Decrypt an AES-256-GCM ciphertext.
 *
 * The Web Crypto API verifies the GCM auth tag automatically and throws an
 * OperationError if verification fails — we never return corrupted data,
 * we surface the failure as a thrown Error so the caller can mark the
 * archive as "corrupted" and refuse to restore it.
 */
export async function decrypt(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> {
  if (iv.length !== GCM_IV_LENGTH) {
    throw new Error(`AES-GCM IV must be ${GCM_IV_LENGTH} bytes (got ${iv.length})`);
  }
  const subtle = ensureSubtle();
  // subtle.decrypt throws if the auth tag does not verify — that is the
  // behavior we want. Catch and rethrow with a clearer message.
  try {
    const plainBuf = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plainBuf);
  } catch (err) {
    throw new Error(
      "AES-GCM authentication failed: ciphertext has been tampered with or was encrypted with a different key.",
      { cause: err },
    );
  }
}

/**
 * Compute the SHA-256 checksum of a byte array, returned as a lowercase
 * hex string (64 chars). Used to detect bit-rot / tampering of ciphertext
 * stored in the vault (defense-in-depth alongside the GCM auth tag).
 */
export async function sha256(data: Uint8Array): Promise<string> {
  const subtle = ensureSubtle();
  const digestBuf = await subtle.digest("SHA-256", data as BufferSource);
  return toHex(new Uint8Array(digestBuf));
}

/** Convert a Uint8Array to a lowercase hex string. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Convert a hex string back to a Uint8Array. */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string must have an even number of characters");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encode a UTF-8 string into a Uint8Array. */
export function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Decode a Uint8Array as UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Throw a clear error if Web Crypto is unavailable.
 *
 * jsdom (used in unit tests) does provide `crypto.subtle` since Node 19+;
 * for older environments, callers should polyfill or skip the test.
 */
function ensureSubtle(): SubtleCrypto {
  const subtle =
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto !== "undefined"
      ? globalThis.crypto.subtle
      : undefined;
  if (!subtle) {
    throw new Error(
      "Web Crypto API (crypto.subtle) is unavailable in this environment. " +
        "Backups require a modern browser or Node 19+.",
    );
  }
  return subtle;
}
