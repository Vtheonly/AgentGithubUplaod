/**
 * RowValidator — per-row orchestrator.
 *
 * Ported from `excel-import-engine/src/validators/RowValidator.js`. Iterates
 * the schema's fields, delegates to `FieldCoercer` for typed coercion, and
 * handles the special `monthlyArray` aggregation that groups N contiguous
 * columns into a month-keyed object.
 *
 * Header matching is case + trim insensitive — the original (case-preserved)
 * header is preferred, but a normalised fallback handles Excel files where
 * the header row has different casing.
 */
import type { ImportSchema, FieldSpec, ImportRecord } from "../types";
import { defaultCoercer } from "./field-coercer";
import { parseNumber, type ParsedNumber } from "./rules/positive-number";
import type { RuleIssue } from "./rules/types";

export interface RowValidationResult {
  record: ImportRecord;
  errors: RuleIssue[];
  warnings: RuleIssue[];
  skipped: boolean;
}

export class RowValidator {
  private readonly schema: ImportSchema;
  private readonly fieldByHeader: Map<string, FieldSpec>;

  constructor(schema: ImportSchema) {
    this.schema = schema;
    this.fieldByHeader = new Map();
    for (const f of schema.fields) {
      const key = (f.header || "").toString().trim().toLowerCase();
      this.fieldByHeader.set(key, f);
    }
  }

  validate(rawRow: Record<string, unknown>, rowIndex: number): RowValidationResult {
    const record: ImportRecord = {};
    const errors: RuleIssue[] = [];
    const warnings: RuleIssue[] = [];

    for (const field of this.schema.fields) {
      if (field.type === "monthlyArray") {
        const arr = this.coerceMonthlyArray(rawRow, field, warnings, rowIndex);
        record[field.key] = arr;
        continue;
      }

      const rawValue = this.lookupValue(rawRow, field);
      const result = defaultCoercer.coerce(rawValue, field);
      record[field.key] = result.value;
      for (const e of result.errors) {
        errors.push({ ...e, field: field.key, header: field.header, rawValue: e.rawValue ?? (rawValue !== undefined ? String(rawValue) : undefined) });
      }
      for (const w of result.warnings) {
        warnings.push({ ...w, field: field.key, header: field.header });
      }
    }

    return { record, errors, warnings, skipped: errors.length > 0 };
  }

  private lookupValue(rawRow: Record<string, unknown>, field: FieldSpec): unknown {
    // 1) Exact match (header as-is in the raw row).
    if (field.header && rawRow[field.header] !== undefined) {
      return rawRow[field.header];
    }
    // 2) Normalised match (case + trim insensitive).
    const targetKey = (field.header || "").toString().trim().toLowerCase();
    if (!targetKey) return undefined;
    for (const k of Object.keys(rawRow)) {
      if (k && k.toString().trim().toLowerCase() === targetKey) {
        return rawRow[k];
      }
    }
    return undefined;
  }

  private coerceMonthlyArray(
    rawRow: Record<string, unknown>,
    field: FieldSpec,
    warnings: RuleIssue[],
    rowIndex: number,
  ): Record<string, number> {
    const count = field.count ?? 12;
    const labels = field.monthLabels ?? [];
    const arr: number[] = new Array(count).fill(0);
    const prefix = (field.header || "").toString().trim().toLowerCase();

    // Heuristic: take the N columns after the header in iteration order.
    const rowKeys = Object.keys(rawRow);
    const headerIdx = rowKeys.findIndex((k) => k.toString().trim().toLowerCase() === prefix);
    if (headerIdx === -1) {
      // Header not found — return zero-filled object.
      return arr.reduce((acc, val, i) => {
        if (labels[i]) acc[labels[i]] = val;
        else acc[String(i)] = val;
        return acc;
      }, {} as Record<string, number>);
    }

    for (let i = 0; i < count; i++) {
      const k = rowKeys[headerIdx + 1 + i];
      if (!k) break;
      let v: unknown = rawRow[k];
      // ExcelJS sometimes returns formula objects without a cached result.
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const obj = v as { result?: unknown; sharedFormula?: unknown; formula?: unknown };
        if (obj.result !== undefined) v = obj.result;
        else if (obj.sharedFormula !== undefined || obj.formula !== undefined) continue;
        else continue;
      }
      if (v === null || v === undefined || v === "") continue;

      const parsed: ParsedNumber = parseNumber(v);
      if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
        warnings.push({
          field: field.key,
          header: k,
          rule: "monthlyArray",
          message: `Valeur mensuelle invalide « ${v} » (colonne ${k})`,
          rawValue: String(v),
        });
      } else if (parsed !== null && typeof parsed === "number") {
        arr[i] = parsed;
      }
    }

    return arr.reduce((acc, val, i) => {
      if (labels[i]) acc[labels[i]] = val;
      else acc[String(i)] = val;
      return acc;
    }, {} as Record<string, number>);
  }
}
