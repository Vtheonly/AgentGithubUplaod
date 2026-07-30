/**
 * UpsertMatcher — extract identity keys from a coerced record.
 *
 * Ported from `excel-import-engine/src/dedupe/UpsertMatcher.js`. Schemas
 * declare identity by header name (e.g. `'NEM'`, `'NOM'`) but coerced
 * records use camelCase keys (`nem`, `nom`). The matcher builds the
 * translation map at construction time.
 *
 * For array values (e.g. `phoneList`), joins with `,` for both extraction
 * and comparison. For dates, normalises to ISO strings.
 */
import type { ImportSchema, ImportRecord } from "../types";

export class UpsertMatcher {
  private readonly schema: ImportSchema;
  readonly identityFields: readonly string[];
  private readonly headerToKey: Map<string, string>;

  constructor(schema: ImportSchema) {
    this.schema = schema;
    this.identityFields = schema.identity?.fields ?? [];
    this.headerToKey = new Map();
    for (const f of schema.fields ?? []) {
      if (f.header) {
        this.headerToKey.set(f.header.toString().trim().toLowerCase(), f.key);
      }
    }
  }

  /**
   * Extract the identity key-value pairs from a coerced record.
   *
   * Iteration 14: identity fields with empty values are *skipped* rather
   * than failing the whole extraction. The identity is built from whichever
   * fields are present. If ALL identity fields are empty, `null` is
   * returned (no usable identity → row rejected).
   *
   * This is critical for the ETAT sheet where `NEM` is optional — rows
   * without a phone still import using `NOM` as the identity. Re-imports
   * dedupe correctly because the same `NOM` produces the same identity
   * hash, and the storage adapter's `upsertRecord` looks up by partial
   * identity match.
   *
   * @returns `{ [fieldKey]: value }` with at least one entry, or `null`
   *          if every identity field is empty.
   */
  extractIdentity(record: ImportRecord): Record<string, string | number> | null {
    if (this.identityFields.length === 0) return null;
    const identity: Record<string, string | number> = {};
    for (const headerName of this.identityFields) {
      const key = this.headerToKey.get(headerName.toString().trim().toLowerCase()) ?? headerName;
      let v: unknown = record[key];
      if (Array.isArray(v)) {
        // Skip empty arrays (e.g. phoneList with no valid numbers).
        if ((v as unknown[]).length === 0) continue;
        v = (v as unknown[]).join(",");
      }
      if (v instanceof Date) v = v.toISOString();
      if (v === null || v === undefined || v === "") continue;
      identity[key] = typeof v === "number" ? v : String(v);
    }
    if (Object.keys(identity).length === 0) return null;
    return identity;
  }

  /** Check whether two records share the same identity. */
  sameIdentity(a: ImportRecord, b: ImportRecord): boolean {
    for (const headerName of this.identityFields) {
      const key = this.headerToKey.get(headerName.toString().trim().toLowerCase()) ?? headerName;
      let va: unknown = a[key];
      let vb: unknown = b[key];
      if (Array.isArray(va)) va = va.join(",");
      if (Array.isArray(vb)) vb = vb.join(",");
      if (va !== vb) return false;
    }
    return true;
  }

  /** Schema's identity strategy: `'upsert'`, `'insert'`, or `'skip'`. */
  strategy(): "upsert" | "insert" | "skip" {
    return this.schema.identity?.strategy ?? "insert";
  }
}
