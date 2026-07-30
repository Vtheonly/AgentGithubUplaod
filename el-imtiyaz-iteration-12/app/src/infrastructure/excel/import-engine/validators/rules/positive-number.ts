/**
 * Règle : nombre positif.
 * Accepte nombre, chaîne numérique, et chaîne avec séparateurs FR (espace, virgule).
 *
 * Ported from `excel-import-engine/src/validators/rules/positiveNumber.js`.
 */
import type { FieldSpec } from "../../types";
import type { RuleIssue } from "./types";

/**
 * Résultat du parsing d'une valeur numérique.
 *
 * - `number` : la valeur a été parsée avec succès.
 * - `null` : la valeur était vide (null, undefined, "").
 * - `{ error: 'ref', raw }` : la valeur est une erreur Excel (`#REF!`, `#N/A`, …).
 * - `{ error: 'nan', raw }` : la valeur n'a pas pu être convertie en nombre.
 */
export type ParsedNumber =
  | number
  | null
  | { readonly error: "ref"; readonly raw: string }
  | { readonly error: "nan"; readonly raw: string };

/**
 * Tente de convertir une valeur brute en nombre.
 *
 * Gère les erreurs Excel (`#REF!`, `#N/A`, …), les séparateurs français
 * (espace, virgule décimale), et les symboles monétaires (`DA`, `€`, `$`).
 */
export function parseNumber(raw: unknown): ParsedNumber {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  let s = String(raw).trim();
  // Détecter #REF! ou autres erreurs Excel
  if (/^#REF!|^#N\/A|^#VALUE!|^#NAME\?|^#DIV\/0!|^#NULL!|^#NUM!$/.test(s)) {
    return { error: "ref", raw: s };
  }
  // Retirer espaces fines et insécables
  s = s.replace(/[\s\u00A0]/g, "").replace(/\s/g, "");
  // Remplacer virgule décimale
  s = s.replace(",", ".");
  // Retirer éventuels symboles monétaires
  s = s.replace(/[DA€$]/gi, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return { error: "nan", raw: String(raw) };
  return n;
}

/**
 * Valide qu'une valeur est un nombre compris entre `field.min` et `field.max`.
 *
 * @returns `RuleIssue` si la valeur est non vide et invalide (erreur de
 *          parsing ou hors bornes), sinon `null`.
 */
export function positiveNumber(value: unknown, field: FieldSpec): RuleIssue | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseNumber(value);
  // Erreur de parsing Excel ou NaN
  if (parsed !== null && typeof parsed === "object") {
    return {
      field: field.key,
      header: field.header,
      rule: "positiveNumber",
      message: `Valeur numérique invalide : « ${value} »`,
    };
  }
  if (parsed === null) return null;
  // Ici `parsed` est un nombre
  if (typeof field.min === "number" && parsed < field.min) {
    return {
      field: field.key,
      header: field.header,
      rule: "positiveNumber",
      message: `Valeur ${parsed} inférieure au minimum ${field.min} pour « ${field.header || field.key} »`,
    };
  }
  if (typeof field.max === "number" && parsed > field.max) {
    return {
      field: field.key,
      header: field.header,
      rule: "positiveNumber",
      message: `Valeur ${parsed} supérieure au maximum ${field.max} pour « ${field.header || field.key} »`,
    };
  }
  return null;
}
