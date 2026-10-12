/**
 * zip-reader.ts — T-505 (BKUP-511): the production STORE-method ZIP reader.
 *
 * The writer (`zip-writer.ts`, T-382) emits a dependency-free STORE-method
 * ZIP (no compression — the archives it carries are already gzip/encrypted).
 * The restore-from-file workflow must parse those ZIPs BACK: the manifest,
 * the per-archive ciphertext, and the per-archive IV files.
 *
 * The reader accepts EXACTLY the subset the writer emits (STORE, no
 * data descriptor, no zip64, UTF-8 names, one local header per central
 * record) and throws a clear, typed error on anything else — a foreign ZIP
 * (e.g. a Deflate-compressed file from another tool) fails validation with
 * an explicit message instead of producing garbage.
 */

export interface ReadZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** The typed reader error (the validation ladder's honest failure surface). */
export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

function readU16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** Read every entry out of a STORE-method ZIP (the writer's format). */
export function readZip(zip: Uint8Array): ReadZipEntry[] {
  if (zip.length < 22) {
    throw new ZipFormatError("Fichier trop court pour être une archive ZIP valide.");
  }
  // Find the end-of-central-directory record (scan backwards — the writer
  // never writes a comment).
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (readU32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new ZipFormatError("Enregistrement de fin de répertoire ZIP introuvable — le fichier n'est pas une archive ZIP valide (ou elle est tronquée).");
  }
  const count = readU16(zip, eocd + 10);
  let offset = readU32(zip, eocd + 16);

  const entries: ReadZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (readU32(zip, offset) !== 0x02014b50) {
      throw new ZipFormatError("Répertoire central ZIP corrompu (signature invalide).");
    }
    const method = readU16(zip, offset + 10);
    if (method !== 0) {
      throw new ZipFormatError(
        "Méthode de compression non supportée (Deflate) — seules les archives ZIP produites par l'application (méthode STORE) sont restaurables.",
      );
    }
    const size = readU32(zip, offset + 20);
    const nameLen = readU16(zip, offset + 28);
    const localOffset = readU32(zip, offset + 42);
    const name = new TextDecoder().decode(zip.slice(offset + 46, offset + 46 + nameLen));

    // The local header must agree with the central record.
    if (readU32(zip, localOffset) !== 0x04034b50) {
      throw new ZipFormatError(`En-tête local invalide pour ${name}.`);
    }
    const localNameLen = readU16(zip, localOffset + 26);
    const dataStart = localOffset + 30 + localNameLen;
    if (dataStart + size > zip.length) {
      throw new ZipFormatError(`Données tronquées pour ${name} — l'archive est incomplète.`);
    }
    entries.push({ name, data: zip.slice(dataStart, dataStart + size) });
    offset += 46 + nameLen;
  }
  return entries;
}

/** Find one entry by exact name (null when absent). */
export function findZipEntry(entries: ReadonlyArray<ReadZipEntry>, name: string): ReadZipEntry | null {
  return entries.find((e) => e.name === name) ?? null;
}
