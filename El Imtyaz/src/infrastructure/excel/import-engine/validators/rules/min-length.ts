/**
 * Règle : longueur minimale de chaîne.
 *
 * Ported from `excel-import-engine/src/validators/rules/minLength.js`.
 */
import type { FieldSpec } from "../../types";
import type { RuleIssue } from "./types";

/**
 * Valide qu'une chaîne respecte la longueur minimale `field.minLength`.
 *
 * @returns `RuleIssue` si la valeur (trimée) est plus courte que `minLength`,
 *          sinon `null`. Si `field.minLength` n'est pas défini, la règle
 *          est inactive. Les valeurs vides ne déclenchent pas d'erreur.
 */
export function minLength(value: unknown, field: FieldSpec): RuleIssue | null {
  if (typeof field.minLength !== "number") return null;
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (s.length < field.minLength) {
    return {
      field: field.key,
      header: field.header,
      rule: "minLength",
      message: `Valeur trop courte (${s.length} < ${field.minLength}) pour « ${field.header || field.key} »`,
    };
  }
  return null;
}
