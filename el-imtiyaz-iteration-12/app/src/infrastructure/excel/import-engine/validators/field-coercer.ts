/**
 * FieldCoercer — type-aware coercion + validation dispatch.
 *
 * Ported from `excel-import-engine/src/validators/FieldCoercer.js`. The
 * coercion pipeline is strictly ordered:
 *   1. Excel error detection (`#REF!`, `#N/A`, …) → error or warning.
 *   2. Required check → error if missing.
 *   3. Empty optional → use default value.
 *   4. Type dispatch (string, email, phone, number, enum, date, …).
 *   5. Structural rules (minLength) for string/email types.
 */
import type { FieldSpec, ImportRecord } from "../types";
import { required } from "./rules/required";
import { phone, phoneList, normalizePhone } from "./rules/phone";
import { positiveNumber, parseNumber, type ParsedNumber } from "./rules/positive-number";
import { enumRule } from "./rules/enum";
import { email as emailRule } from "./rules/email";
import { minLength } from "./rules/min-length";
import type { RuleIssue } from "./rules/types";

export interface CoerceResult {
  value: unknown;
  errors: RuleIssue[];
  warnings: RuleIssue[];
}

const EXCEL_ERROR_RE = /^#REF!|^#N\/A|^#VALUE!|^#NAME\?|^#DIV\/0!|^#NULL!|^#NUM!$/;

export class FieldCoercer {
  coerce(rawValue: unknown, field: FieldSpec): CoerceResult {
    const errors: RuleIssue[] = [];
    const warnings: RuleIssue[] = [];

    // 1) Excel formula errors (#REF!, #N/A, etc.)
    if (this.isExcelError(rawValue)) {
      const issue: RuleIssue = {
        field: field.key,
        header: field.header,
        rule: "excelError",
        message: `Erreur de formule Excel « ${rawValue} » dans le champ « ${field.header || field.key} »`,
        rawValue: String(rawValue),
      };
      if (field.required) errors.push(issue);
      else warnings.push(issue);
      return { value: null, errors, warnings };
    }

    // 2) Required check
    const reqErr = required(rawValue, field);
    if (reqErr) {
      errors.push(reqErr);
      return { value: field.default ?? null, errors, warnings };
    }

    // 3) Empty optional → default
    if (rawValue === null || rawValue === undefined || (typeof rawValue === "string" && rawValue.trim() === "")) {
      return { value: field.default ?? null, errors, warnings };
    }

    // 4) Type dispatch
    let coercedValue: unknown = rawValue;
    switch (field.type) {
      case "string": {
        let s = String(rawValue).trim();
        if (field.uppercase) s = s.toUpperCase();
        if (field.lowercase) s = s.toLowerCase();
        coercedValue = s;
        break;
      }

      case "email": {
        const e = emailRule(rawValue, field);
        if (e) {
          // Per Iteration 14: an invalid email on an OPTIONAL field is a
          // warning, not an error. The real spreadsheet occasionally has
          // non-email values in the E-MAIL column (e.g. "BON01" used as a
          // cross-reference to the BON sheet). Blocking the entire row on
          // such cells would reject many valid students.
          if (field.required) {
            errors.push(e);
          } else {
            warnings.push(e);
            coercedValue = String(rawValue).trim();
          }
        } else {
          coercedValue = String(rawValue).trim().toLowerCase();
        }
        break;
      }

      case "phone":
      case "phoneList": {
        const e = field.type === "phoneList" ? phoneList(rawValue, field) : phone(rawValue, field);
        if (e) {
          // The phone rule returns an issue only when at least one part is invalid.
          // Whether it's a warning or an error depends on whether ALL parts failed —
          // the rule message describes the failure; the caller (RowValidator) decides
          // severity. For now, treat all phone issues as warnings (tolerant).
          warnings.push(e);
        } else {
          const parts = String(rawValue).split(/[/,]/).map((s) => s.trim()).filter(Boolean);
          coercedValue = parts.map((p) => normalizePhone(p));
          if (field.type === "phone" && Array.isArray(coercedValue)) {
            coercedValue = (coercedValue as string[])[0] ?? null;
          }
        }
        break;
      }

      case "number":
      case "numberOrRef": {
        const parsed: ParsedNumber = parseNumber(rawValue);
        if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
          // Parse failed
          if (field.type === "numberOrRef") {
            warnings.push({
              field: field.key,
              header: field.header,
              rule: "numberOrRef",
              message: `Valeur « ${rawValue} » traitée comme référence dans « ${field.header || field.key} »`,
              rawValue: String(rawValue),
            });
            coercedValue = null;
          } else {
            errors.push({
              field: field.key,
              header: field.header,
              rule: "number",
              message: `Valeur numérique invalide : « ${rawValue} »`,
              rawValue: String(rawValue),
            });
            coercedValue = null;
          }
        } else if (parsed === null) {
          coercedValue = field.default ?? null;
        } else {
          // parsed is a number
          const e = positiveNumber(parsed as number, field);
          if (e) errors.push(e);
          coercedValue = parsed;
        }
        break;
      }

      case "enum": {
        const e = enumRule(rawValue, field);
        if (e) {
          // Per Iteration 14: when `tolerateUnknown` is set on the field,
          // unknown enum values become warnings (not errors) so the row
          // still imports. This is critical for fields like `niveau` and
          // `OPTION` where the real spreadsheet contains operator-invented
          // variants that aren't in the canonical enum.
          if (field.tolerateUnknown) {
            warnings.push(e);
            coercedValue = String(rawValue).trim().toUpperCase();
          } else {
            errors.push(e);
          }
        } else {
          coercedValue = String(rawValue).trim().toUpperCase();
        }
        break;
      }

      case "date": {
        if (rawValue instanceof Date) {
          coercedValue = rawValue;
        } else {
          const d = new Date(rawValue as string);
          if (Number.isNaN(d.getTime())) {
            warnings.push({
              field: field.key,
              header: field.header,
              rule: "date",
              message: `Date invalide « ${rawValue} » dans « ${field.header || field.key} »`,
              rawValue: String(rawValue),
            });
            coercedValue = null;
          } else {
            coercedValue = d;
          }
        }
        break;
      }

      default:
        coercedValue = rawValue;
    }

    // 5) Structural rules
    if (field.type === "string" || field.type === "email") {
      const e = minLength(coercedValue, field);
      if (e) errors.push(e);
    }

    return { value: coercedValue, errors, warnings };
  }

  isExcelError(v: unknown): boolean {
    if (typeof v !== "string") return false;
    return EXCEL_ERROR_RE.test(v.trim());
  }
}

export const defaultCoercer = new FieldCoercer();

/** Convenience top-level export for callers that just need one-shot coercion. */
export function coerceField(rawValue: unknown, field: FieldSpec): CoerceResult {
  return defaultCoercer.coerce(rawValue, field);
}

/** Helper for tests: coerce a record (field-keyed) into a typed record. */
export function coerceRecord(
  rawRow: Record<string, unknown>,
  fields: readonly FieldSpec[],
): { record: ImportRecord; errors: RuleIssue[]; warnings: RuleIssue[] } {
  const record: ImportRecord = {};
  const errors: RuleIssue[] = [];
  const warnings: RuleIssue[] = [];
  for (const field of fields) {
    const rawValue = rawRow[field.header] ?? rawRow[field.key];
    const result = defaultCoercer.coerce(rawValue, field);
    record[field.key] = result.value;
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return { record, errors, warnings };
}
