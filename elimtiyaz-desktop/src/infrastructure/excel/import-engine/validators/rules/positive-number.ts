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
 * (espace, virgule décimale), et les symboles monétaires (`DA`, `DZD`,
 * `€`, `$`).
 *
 * T-582 / BUG-052 (2026-11-23): les deux pièges de l'ancien parseur sont
 * fermés — (1) la devise n'est plus un char-class `[DA€$]` qui effaçait les
 * LETTRES D et A n'importe où ("1D500" devenait silencieusement 1500) :
 * seul un jeton de devise EN FIN de chaîne est retiré ; (2) le point n'est
 * un séparateur de milliers QUE s'il est suivi d'exactement 3 chiffres
 * puis d'un séparateur ou de la fin ("1.500" → 1500, "1.500,00" → 1500) ;
 * tout autre point reste décimal ("1.5" → 1.5, "12.34" → 12.34).
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
  // BUG-052 (1) : devise = jeton EN FIN uniquement (DZD, DA, €, $) —
  // jamais un char-class de lettres. "500 DA" → 500 ; "1D500" reste
  // "1D500" → erreur nan (fail-closed), plus 1500 silencieux.
  s = s.replace(/(DZD|DA|€|\$)$/i, "");
  // Remplacer virgule décimale
  s = s.replace(",", ".");
  // BUG-052 (2) : point = milliers seulement devant exactement 3 chiffres
  // suivis d'un séparateur ou de la fin. Les autres points restent décimaux.
  s = s.replace(/\.(\d{3})(?=[^\d]|$)/g, "$1");
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
