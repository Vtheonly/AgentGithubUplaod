/**
 * T-415 (issue #13) — AES-256-GCM crypto + IndexedDB vault hardening suite.
 *
 * The deepest directly-crypto-level coverage the backup stack has ever had
 * (the exploration audit found NO dedicated suite for aes-256.ts — only
 * indirect coverage via t-300). Pins:
 *
 *   1. Round-trips: unicode / binary / large / empty payloads.
 *   2. IV hygiene: fresh random 12-byte IV per encryption (never reused),
 *      wrong-length IVs rejected outright.
 *   3. Tamper detection: first / middle / last ciphertext byte, truncation.
 *   4. Key hygiene: PBKDF2 iteration constant (100k), key non-extractable,
 *      empty passphrase rejected, salt minimum length enforced.
 *   5. Wrong passphrase: decrypt fails loudly (never garbage plaintext).
 *   6. sha256: determinism + known-answer vectors + hex helpers.
 *   7. Vault: store/get round-trip, metadata listing, delete, missing
 *      archive, retention purge (aged removed / fresh kept), overwrite.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  generateKey,
  encrypt,
  decrypt,
  sha256,
  toHex,
  fromHex,
  encodeUtf8,
  decodeUtf8,
  PBKDF2_ITERATIONS,
  GCM_IV_LENGTH,
  AES_256_KEY_LENGTH,
} from "../../infrastructure/backup/aes-256";
import {
  storeArchive,
  getArchive,
  listArchiveMetadata,
  deleteArchive as vaultDelete,
  purgeExpired as vaultPurge,
  clearVault,
} from "../../infrastructure/backup/indexed-db-vault";
import type { BackupArchive } from "../../domain/model/backup";
import { BACKUP_PBKDF2_ITERATIONS, BACKUP_GCM_IV_LENGTH } from "../../domain/model/backup";

const SALT = encodeUtf8("el-imtiyaz-backup-salt-v1");
const PASSPHRASE = "phrase-de-test-t415";

async function keyFor(pass = PASSPHRASE): Promise<CryptoKey> {
  return generateKey(pass, SALT);
}

beforeEach(async () => {
  await clearVault();
});

/* ------------------------------------------------------------------ */
/*  1. Round-trips                                                     */
/* ------------------------------------------------------------------ */

describe("T-415 — AES-256-GCM round-trips", () => {
  it("round-trips a unicode payload (Arabic + French + emoji-free CJK)", async () => {
    const key = await keyFor();
    const plaintext = encodeUtf8(
      "Élève أَحْمَد — parent O’Connor, 1 234,56 DZD · élève №42 «très bien» 学生",
    );
    const { ciphertext, iv } = await encrypt(plaintext, key);
    const back = await decrypt(ciphertext, iv, key);
    expect(decodeUtf8(back)).toBe(
      "Élève أَحْمَد — parent O’Connor, 1 234,56 DZD · élève №42 «très bien» 学生",
    );
  });

  it("round-trips binary data with all 256 byte values", async () => {
    const key = await keyFor();
    const plaintext = new Uint8Array(256);
    for (let i = 0; i < 256; i++) plaintext[i] = i;
    const { ciphertext, iv } = await encrypt(plaintext, key);
    const back = await decrypt(ciphertext, iv, key);
    expect(Array.from(back)).toEqual(Array.from(plaintext));
  });

  it("round-trips a 1 MB payload (the realistic archive scale)", async () => {
    const key = await keyFor();
    const plaintext = new Uint8Array(1_048_576);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 7 + 13) & 0xff;
    const { ciphertext, iv } = await encrypt(plaintext, key);
    const back = await decrypt(ciphertext, iv, key);
    expect(back.length).toBe(plaintext.length);
    // Spot-check instead of a full 1M-element deep compare (speed).
    expect(back[0]).toBe(plaintext[0]);
    expect(back[524_288]).toBe(plaintext[524_288]);
    expect(back[1_048_575]).toBe(plaintext[1_048_575]);
  });

  it("round-trips an EMPTY payload (the zero-byte edge)", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(new Uint8Array(0), key);
    // GCM on empty plaintext yields the 16-byte auth tag only.
    expect(ciphertext.length).toBe(16);
    const back = await decrypt(ciphertext, iv, key);
    expect(back.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  2. IV hygiene                                                      */
/* ------------------------------------------------------------------ */

describe("T-415 — IV hygiene (NIST SP 800-38D)", () => {
  it("generates a FRESH random 12-byte IV for every encryption (100 samples, zero reuse)", async () => {
    const key = await keyFor();
    const plaintext = encodeUtf8("same-plaintext-every-time");
    const ivs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { iv } = await encrypt(plaintext, key);
      expect(iv.length).toBe(GCM_IV_LENGTH);
      ivs.add(toHex(iv));
    }
    expect(ivs.size).toBe(100);
  });

  it("rejects a wrong-length IV at decrypt time (11 / 13 / 0 bytes)", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(encodeUtf8("iv-length-test"), key);
    for (const bad of [
      iv.slice(0, 11),
      new Uint8Array([...iv, 0]),
      new Uint8Array(0),
    ]) {
      await expect(decrypt(ciphertext, bad, key)).rejects.toThrow(/IV must be 12 bytes/);
    }
  });

  it("the constants agree with the domain model (12-byte IV, 100k PBKDF2, AES-256)", () => {
    expect(GCM_IV_LENGTH).toBe(12);
    expect(BACKUP_GCM_IV_LENGTH).toBe(12);
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(BACKUP_PBKDF2_ITERATIONS).toBe(100_000);
    expect(AES_256_KEY_LENGTH).toBe(256);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Tamper detection                                                */
/* ------------------------------------------------------------------ */

describe("T-415 — tamper detection (GCM auth tag)", () => {
  it("a flipped byte at the START of the ciphertext fails decryption", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(encodeUtf8("start-byte-tamper"), key);
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;
    await expect(decrypt(tampered, iv, key)).rejects.toThrow(/authentication failed/);
  });

  it("a flipped byte in the MIDDLE of the ciphertext fails decryption", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(encodeUtf8("middle-byte-tamper"), key);
    const tampered = new Uint8Array(ciphertext);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    await expect(decrypt(tampered, iv, key)).rejects.toThrow(/authentication failed/);
  });

  it("a flipped byte at the END of the ciphertext fails decryption (the tag itself)", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(encodeUtf8("tag-byte-tamper"), key);
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0x01;
    await expect(decrypt(tampered, iv, key)).rejects.toThrow(/authentication failed/);
  });

  it("a TRUNCATED ciphertext (dropped tag) fails decryption", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(encodeUtf8("truncated-archive"), key);
    const truncated = ciphertext.slice(0, ciphertext.length - 8);
    await expect(decrypt(truncated, iv, key)).rejects.toThrow();
  });

  it("an EXTENDED ciphertext (appended junk) fails decryption", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(encodeUtf8("extended-archive"), key);
    const extended = new Uint8Array([...ciphertext, 0, 0, 0, 0]);
    await expect(decrypt(extended, iv, key)).rejects.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  4. Key hygiene                                                     */
/* ------------------------------------------------------------------ */

describe("T-415 — key derivation hygiene (PBKDF2)", () => {
  it("an empty passphrase is rejected outright", async () => {
    await expect(generateKey("", SALT)).rejects.toThrow(/must not be empty/);
  });

  it("a salt shorter than 16 bytes is rejected outright", async () => {
    await expect(generateKey(PASSPHRASE, encodeUtf8("short-salt"))).rejects.toThrow(
      /Salt must be at least 16 bytes/,
    );
  });

  it("the derived key is NON-EXTRACTABLE (an XSS cannot export the raw key bytes)", async () => {
    const key = await keyFor();
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("different passphrases derive different keys (and cannot cross-decrypt)", async () => {
    const keyA = await keyFor("alpha-passphrase");
    const keyB = await keyFor("beta-passphrase");
    const { ciphertext, iv } = await encrypt(encodeUtf8("cross-key-test"), keyA);
    await expect(decrypt(ciphertext, iv, keyB)).rejects.toThrow(/authentication failed/);
  });

  it("the same passphrase + salt derives the SAME key (deterministic derivation)", async () => {
    const k1 = await keyFor();
    const k2 = await keyFor();
    // Deterministic derivation proven by cross-decrypting with the twin key.
    const { ciphertext, iv } = await encrypt(encodeUtf8("determinism"), k1);
    await expect(decrypt(ciphertext, iv, k2)).resolves.toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  5. sha256 + hex helpers                                            */
/* ------------------------------------------------------------------ */

describe("T-415 — SHA-256 checksum + hex helpers", () => {
  it("sha256 is deterministic and hex-formatted (64 lowercase chars)", async () => {
    const data = encodeUtf8("t415-checksum-vector");
    const h1 = await sha256(data);
    const h2 = await sha256(data);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("known-answer vectors (empty string + 'abc')", async () => {
    expect(await sha256(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256(encodeUtf8("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("toHex / fromHex round-trip arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);
    expect(toHex(bytes)).toBe("00010f107f80feff");
    expect(Array.from(fromHex(toHex(bytes)))).toEqual(Array.from(bytes));
  });

  it("fromHex rejects odd-length input", () => {
    expect(() => fromHex("abc")).toThrow(/even number/);
  });
});

/* ------------------------------------------------------------------ */
/*  6. The IndexedDB vault                                             */
/* ------------------------------------------------------------------ */

function fakeArchive(id: string, createdAtDaysAgo = 0): { metadata: BackupArchive } {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const createdAt = new Date(now - createdAtDaysAgo * day).toISOString();
  return {
    metadata: {
      id,
      tenantId: "tenant-el-imtiyaz-oran-001",
      createdAt,
      sizeBytes: 128,
      checksum: "a".repeat(64),
      vaultLocation: "local",
      status: "encrypted",
      retentionExpiresAt: new Date(
        now - createdAtDaysAgo * day + 365 * day,
      ).toISOString(),
      createdBy: "vault-tester",
      metadata: { parentCount: 1, studentCount: 1, paymentCount: 1, ledgerEntryCount: 1 },
    },
  };
}

describe("T-415 — the IndexedDB vault (storage + retention)", () => {
  it("storeArchive → getArchive round-trips ciphertext + iv + metadata byte-exactly", async () => {
    const key = await keyFor();
    const { ciphertext, iv } = await encrypt(encodeUtf8("vault-round-trip"), key);
    const { metadata } = fakeArchive("backup-vault-rt.db");
    await storeArchive({ id: metadata.id, metadata, ciphertext, iv });

    const record = await getArchive(metadata.id);
    expect(record).not.toBeNull();
    expect(Array.from(record!.ciphertext)).toEqual(Array.from(ciphertext));
    expect(Array.from(record!.iv)).toEqual(Array.from(iv));
    expect(record!.metadata.checksum).toBe(metadata.checksum);
  });

  it("getArchive returns null for a missing archive (honest absence)", async () => {
    expect(await getArchive("backup-does-not-exist.db")).toBeNull();
  });

  it("listArchiveMetadata returns every stored archive's metadata (id match)", async () => {
    const a = fakeArchive("backup-list-a.db");
    const b = fakeArchive("backup-list-b.db");
    await storeArchive({ id: a.metadata.id, metadata: a.metadata, ciphertext: new Uint8Array([1]), iv: new Uint8Array(12) });
    await storeArchive({ id: b.metadata.id, metadata: b.metadata, ciphertext: new Uint8Array([2]), iv: new Uint8Array(12) });
    const listed = await listArchiveMetadata();
    const ids = listed.map((m) => m.id);
    expect(ids).toContain("backup-list-a.db");
    expect(ids).toContain("backup-list-b.db");
  });

  it("re-storing the SAME id overwrites (no duplicate rows)", async () => {
    const a = fakeArchive("backup-overwrite.db");
    await storeArchive({ id: a.metadata.id, metadata: a.metadata, ciphertext: new Uint8Array([1]), iv: new Uint8Array(12) });
    const grown = { ...a.metadata, sizeBytes: 999 };
    await storeArchive({ id: a.metadata.id, metadata: grown, ciphertext: new Uint8Array([1, 2, 3]), iv: new Uint8Array(12) });
    const listed = await listArchiveMetadata();
    expect(listed.filter((m) => m.id === "backup-overwrite.db")).toHaveLength(1);
    const record = await getArchive("backup-overwrite.db");
    expect(record!.metadata.sizeBytes).toBe(999);
  });

  it("deleteArchive removes exactly the targeted archive", async () => {
    const a = fakeArchive("backup-del-a.db");
    const b = fakeArchive("backup-del-b.db");
    await storeArchive({ id: a.metadata.id, metadata: a.metadata, ciphertext: new Uint8Array([1]), iv: new Uint8Array(12) });
    await storeArchive({ id: b.metadata.id, metadata: b.metadata, ciphertext: new Uint8Array([2]), iv: new Uint8Array(12) });
    await vaultDelete("backup-del-a.db");
    expect(await getArchive("backup-del-a.db")).toBeNull();
    expect(await getArchive("backup-del-b.db")).not.toBeNull();
  });

  it("purgeExpired removes ONLY archives past retention (the 365-day sweep)", async () => {
    // retentionExpiresAt is derived from createdAt + 365d, so "400 days old"
    // means expired, "100 days old" means retained.
    const expired1 = fakeArchive("backup-purge-old-1.db", 400);
    const expired2 = fakeArchive("backup-purge-old-2.db", 500);
    const fresh = fakeArchive("backup-purge-fresh.db", 100);
    for (const f of [expired1, expired2, fresh]) {
      await storeArchive({
        id: f.metadata.id,
        metadata: f.metadata,
        ciphertext: new Uint8Array([1]),
        iv: new Uint8Array(12),
      });
    }
    const purgedIds = await vaultPurge(365);
    expect(purgedIds).toContain("backup-purge-old-1.db");
    expect(purgedIds).toContain("backup-purge-old-2.db");
    expect(purgedIds).not.toContain("backup-purge-fresh.db");
    expect(await getArchive("backup-purge-old-1.db")).toBeNull();
    expect(await getArchive("backup-purge-fresh.db")).not.toBeNull();
  });

  it("the encrypted vault NEVER stores plaintext (ciphertext only in the record)", async () => {
    const key = await keyFor();
    const secret = "PLAINTEXT-NEVER-AT-REST-1234567890";
    const { ciphertext, iv } = await encrypt(encodeUtf8(secret), key);
    const a = fakeArchive("backup-no-plaintext.db");
    await storeArchive({ id: a.metadata.id, metadata: a.metadata, ciphertext, iv });
    const record = await getArchive(a.metadata.id);
    // The secret bytes must not appear verbatim anywhere in the stored record.
    const haystack = [
      ...Array.from(record!.ciphertext),
      ...Array.from(record!.iv),
      JSON.stringify(record!.metadata),
    ];
    const secretBytes = Array.from(encodeUtf8(secret));
    const contains = haystack.some((_, i) =>
      secretBytes.every((b, j) => haystack[i + j] === b),
    );
    expect(contains).toBe(false);
  });
});
