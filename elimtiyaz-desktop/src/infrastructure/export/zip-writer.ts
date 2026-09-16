/**
 * zip-writer.ts — a minimal, dependency-free ZIP writer (T-382 / BKUP-500).
 *
 * Why hand-rolled: package.json carries NO zip library (checked 2026-09-16 —
 * exceljs produces xlsx only, pdf-lib PDFs only), and adding a runtime
 * dependency for an archive-export feature would be the heaviest possible
 * change. The STORE method (no compression) is the right trade here anyway:
 * every payload this writer carries is ALREADY compressed container data
 * (xlsx = a deflated OPC package; the backup archives = AES-GCM over gzip —
 * §15.9-class incompressible ciphertext), so DEFLATE would burn CPU for a
 * few percent at best.
 *
 * Format implemented (PKWARE APPNOTE 6.3.x, the minimum a reader needs):
 *   - one local file header + stored data per entry (0x04034b50)
 *   - one central directory record per entry (0x02014b50)
 *   - the end-of-central-directory record (0x06054b50)
 *   - UTF-8 filenames flagged via the general-purpose bit 11
 *
 * The t-382 suite parses the output back and verifies every entry's bytes
 * round-trip (the reader checks local headers against the central
 * directory) — see src/tests/features/t-382-export-workflow.test.tsx.
 */

/** CRC-32 (IEEE 802.3, reversed polynomial 0xEDB88320) — table-driven. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time (local time, 2-second granularity). */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f);
  const year = Math.max(1980, date.getFullYear());
  const dosDate =
    ((year - 1980) & 0x7f) << 9 |
    ((date.getMonth() + 1) & 0x0f) << 5 |
    (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

/** One entry to add to the archive. */
export interface ZipEntry {
  /** Path inside the archive (folders via "dir/file", no leading slash). */
  name: string;
  /** The raw file bytes (stored as-is — no compression). */
  data: Uint8Array;
}

/** A little-endian byte writer. */
class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  get byteLength(): number {
    return this.length;
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    const b = new Uint8Array(2);
    b[0] = value & 0xff;
    b[1] = (value >>> 8) & 0xff;
    this.push(b);
  }

  u32(value: number): void {
    const b = new Uint8Array(4);
    b[0] = value & 0xff;
    b[1] = (value >>> 8) & 0xff;
    b[2] = (value >>> 16) & 0xff;
    b[3] = (value >>> 24) & 0xff;
    this.push(b);
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Flag bit 11 — the filename is UTF-8 (names with accents stay intact). */
const UTF8_FLAG = 0x0800;

/**
 * Build a STORE-method ZIP archive from the entries. Throws on duplicate
 * names or empty names (a malformed archive is worse than a loud error).
 */
export function buildZip(entries: ZipEntry[], at: Date = new Date()): Uint8Array {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith("/")) {
      throw new Error(`Invalid zip entry name: "${entry.name}"`);
    }
    if (seen.has(entry.name)) {
      throw new Error(`Duplicate zip entry name: "${entry.name}"`);
    }
    seen.add(entry.name);
  }

  const local = new ByteWriter();
  const central = new ByteWriter();
  const { time, date } = dosDateTime(at);

  entries.forEach((entry) => {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const localHeaderOffset = local.byteLength;

    // Local file header.
    local.u32(0x04034b50); // signature
    local.u16(20); // version needed (2.0)
    local.u16(UTF8_FLAG); // general purpose flags
    local.u16(0); // method: STORE
    local.u16(time);
    local.u16(date);
    local.u32(crc);
    local.u32(entry.data.length); // compressed size (== stored size)
    local.u32(entry.data.length); // uncompressed size
    local.u16(nameBytes.length);
    local.u16(0); // extra field length
    local.push(nameBytes);
    local.push(entry.data);

    // Central directory record.
    central.u32(0x02014b50); // signature
    central.u16(20); // version made by (MS-DOS, spec 2.0)
    central.u16(20); // version needed
    central.u16(UTF8_FLAG);
    central.u16(0); // method: STORE
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(entry.data.length);
    central.u32(entry.data.length);
    central.u16(nameBytes.length);
    central.u16(0); // extra length
    central.u16(0); // comment length
    central.u16(0); // disk number start
    central.u16(0); // internal attrs
    central.u32(0); // external attrs (0 — regular file)
    central.u32(localHeaderOffset);
    central.push(nameBytes);
  });

  // End of central directory.
  const eocd = new ByteWriter();
  eocd.u32(0x06054b50);
  eocd.u16(0); // this disk
  eocd.u16(0); // disk with the central directory
  eocd.u16(entries.length); // entries on this disk
  eocd.u16(entries.length); // total entries
  eocd.u32(central.byteLength);
  eocd.u32(local.byteLength); // central directory offset
  eocd.u16(0); // comment length

  local.push(central.toUint8Array());
  local.push(eocd.toUint8Array());
  return local.toUint8Array();
}
