/**
 * Règle : champ obligatoire. Vérifie que la valeur n'est pas nulle,
 * undefined, ou une chaîne vide après trim.
 *
 * Ported from `excel-import-engine/src/validators/rules/required.js`.
 */
import type { FieldSpec } from "../../types";
import type { RuleIssue } from "./types";

/**
 * Vérifie qu'un champ obligatoire est présent et non vide.
 *
 * @param value  Valeur brute de la cellule.
 * @param field  Spécification du champ (utilise `key`, `header`, `required`).
 * @returns `RuleIssue` si la valeur est absente/vide, sinon `null`.
 */
export function required(value: unknown, field: FieldSpec): RuleIssue | null {
  if (field.required === false) return null;
  if (value === null || value === undefined) {
    return {
      field: field.key,
      header: field.header,
      rule: "required",
      message: `Champ obligatoire manquant : « ${field.header || field.key} »`,
    };
  }
  if (typeof value === "string" && value.trim() === "") {
    return {
      field: field.key,
      header: field.header,
      rule: "required",
      message: `Champ obligatoire vide : « ${field.header || field.key} »`,
    };
  }
  return null;
}
