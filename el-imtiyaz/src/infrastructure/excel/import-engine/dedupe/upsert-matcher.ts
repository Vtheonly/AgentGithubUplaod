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
   * @returns `{ [fieldKey]: value }` or `null` if any identity field is missing.
   */
  extractIdentity(record: ImportRecord): Record<string, string | number> | null {
    if (this.identityFields.length === 0) return null;
    const identity: Record<string, string | number> = {};
    for (const headerName of this.identityFields) {
      const key = this.headerToKey.get(headerName.toString().trim().toLowerCase()) ?? headerName;
      let v: unknown = record[key];
      if (Array.isArray(v)) v = (v as unknown[]).join(",");
      if (v instanceof Date) v = v.toISOString();
      if (v === null || v === undefined || v === "") return null;
      identity[key] = typeof v === "number" ? v : String(v);
    }
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
