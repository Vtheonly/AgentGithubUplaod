/**
 * Unit tests for the AES-256-GCM crypto service.
 *
 * Covers:
 *   - PBKDF2 key derivation (algorithm name, extractable=false, key length)
 *   - Encrypt + decrypt round-trip preserves original
 *   - Decrypt with wrong key fails (throws)
 *   - Decrypt with corrupted ciphertext fails (throws on GCM auth tag)
 *   - sha256 produces deterministic 64-char hex string
 *   - sha256 of empty input matches the known NIST value
 *   - IV is 12 bytes and unique across two encrypt calls
 *   - Encrypting a large payload (1MB) works without timing out
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`) which is provided
 * by Node 19+ and modern browsers.
 */
import { describe, it, expect } from "vitest";
import {
  generateKey,
  encrypt,
  decrypt,
  sha256,
  encodeUtf8,
  PBKDF2_ITERATIONS,
  GCM_IV_LENGTH,
} from "../../infrastructure/backup/aes-256";

const SALT = encodeUtf8("el-imtiyaz-test-salt-16b");

describe("AES-256-GCM service", () => {
  it("generateKey produces a non-extractable AES-GCM CryptoKey", async () => {
    const key = await generateKey("test-passphrase", SALT);
    // The Web Crypto API exposes the algorithm + extractable flag via the
    // CryptoKey object. We assert these to confirm PBKDF2 → AES-GCM
    // derivation succeeded.
    expect(key.algorithm.name).toBe("AES-GCM");
    expect(key.extractable).toBe(false);
    expect(key.usages).toContain("encrypt");
    expect(key.usages).toContain("decrypt");
  });

  it("encrypt + decrypt round-trip preserves the original plaintext", async () => {
    const key = await generateKey("round-trip-passphrase", SALT);
    const plaintext = encodeUtf8("Bonjour, monde! — données de sauvegarde.");

    const { ciphertext, iv } = await encrypt(plaintext, key);
    const recovered = await decrypt(ciphertext, iv, key);

    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it("decrypt with a wrong key fails (throws on GCM auth tag)", async () => {
    const key1 = await generateKey("correct-passphrase", SALT);
    const key2 = await generateKey("WRONG-passphrase", SALT);

    const plaintext = encodeUtf8("secret");
    const { ciphertext, iv } = await encrypt(plaintext, key1);

    await expect(decrypt(ciphertext, iv, key2)).rejects.toThrow();
  });

  it("decrypt with corrupted ciphertext fails (throws on GCM auth tag)", async () => {
    const key = await generateKey("corruption-test-passphrase", SALT);
    const plaintext = encodeUtf8("original payload");
    const { ciphertext, iv } = await encrypt(plaintext, key);

    // Flip a byte in the middle of the ciphertext — this should invalidate
    // the GCM auth tag and cause decrypt to throw.
    const corrupted = ciphertext.slice();
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;

    await expect(decrypt(corrupted, iv, key)).rejects.toThrow();
  });

  it("sha256 produces a deterministic 64-char lowercase hex string", async () => {
    const input = encodeUtf8("consistent input");
    const hash1 = await sha256(input);
    const hash2 = await sha256(input);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256 of empty input equals the known NIST value", async () => {
    // Known SHA-256("") value — verifies our implementation against a
    // published reference vector.
    const empty = new Uint8Array(0);
    const hash = await sha256(empty);
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("IV is 12 bytes and unique across two encrypt calls", async () => {
    const key = await generateKey("iv-uniqueness-passphrase", SALT);
    const plaintext = encodeUtf8("same input twice");

    const { iv: iv1 } = await encrypt(plaintext, key);
    const { iv: iv2 } = await encrypt(plaintext, key);

    expect(iv1.length).toBe(GCM_IV_LENGTH);
    expect(iv2.length).toBe(GCM_IV_LENGTH);
    expect(Array.from(iv1)).not.toEqual(Array.from(iv2));
  });

  it("encrypting a 1MB payload works without timing out", async () => {
    const key = await generateKey("large-payload-passphrase", SALT);
    // Build a 1MB payload of pseudo-random bytes.
    const payload = new Uint8Array(1024 * 1024);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = (i * 31 + 7) & 0xff;
    }

    const { ciphertext, iv } = await encrypt(payload, key);
    const recovered = await decrypt(ciphertext, iv, key);

    expect(recovered.length).toBe(payload.length);
    expect(Array.from(recovered)).toEqual(Array.from(payload));
  });

  it("PBKDF2 uses at least 100,000 iterations", () => {
    // The constant is exported so we can verify the iteration count
    // without inspecting the internal CryptoKey (which doesn't expose it).
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100_000);
  });

  it("generateKey throws on empty passphrase", async () => {
    await expect(generateKey("", SALT)).rejects.toThrow();
  });

  it("generateKey throws on a too-short salt (<16 bytes)", async () => {
    const shortSalt = encodeUtf8("short");
    await expect(generateKey("any-passphrase", shortSalt)).rejects.toThrow();
  });
});
