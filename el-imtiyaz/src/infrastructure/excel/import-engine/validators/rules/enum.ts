/**
 * Règle : énumération. Vérifie que la valeur est dans la liste autorisée.
 * Tolérant à la casse et aux espaces.
 *
 * Ported from `excel-import-engine/src/validators/rules/enum.js`.
 *
 * Note: la fonction est nommée `enumRule` car `enum` est un mot réservé
 * en TypeScript. Le champ `rule` du `RuleIssue` reste `"enum"`.
 */
import type { FieldSpec } from "../../types";
import type { RuleIssue } from "./types";

/**
 * Valide qu'une valeur fait partie de l'énumération `field.values`.
 *
 * La comparaison est insensible à la casse et aux espaces (les deux côtés
 * sont trimés et passés en majuscules).
 *
 * @returns `RuleIssue` si la valeur est non vide et absente de la liste,
 *          sinon `null`. Les valeurs vides ne déclenchent pas d'erreur.
 */
export function enumRule(value: unknown, field: FieldSpec): RuleIssue | null {
  if (value === null || value === undefined || value === "") return null;
  const allowed = (field.values ?? []).map((v) => String(v).trim().toUpperCase());
  const v = String(value).trim().toUpperCase();
  if (!allowed.includes(v)) {
    return {
      field: field.key,
      header: field.header,
      rule: "enum",
      message: `Valeur « ${value} » non autorisée pour « ${field.header || field.key} ». Valeurs attendues : ${(field.values ?? []).join(", ")}`,
    };
  }
  return null;
}
