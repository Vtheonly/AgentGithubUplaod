/**
 * Règle : numéro de téléphone algérien.
 * Accepte les formats :
 *   - 0XXXXXXXXX (10 chiffres, commence par 0)
 *   - 0XXX.XXX.XXX
 *   - 0XXX XX XX XX
 *   - +213XXXXXXXXX
 *
 * Une valeur "phoneList" est acceptée : plusieurs numéros séparés par "/" ou ",".
 * Retourne un tableau normalisé de numéros.
 *
 * Ported from `excel-import-engine/src/validators/rules/phone.js`.
 *
 * Note: la version originale renvoyait un champ `severity` ("error" si tous
 * les numéros sont invalides, "warn" sinon). Ici, `RuleIssue` ne porte pas
 * de sévérité — c'est l'`ImportContext` qui l'ajoute. Le message indique
 * quels numéros ont échoué afin que l'appelant puisse décider.
 */
import type { FieldSpec } from "../../types";
import type { RuleIssue } from "./types";

const PHONE_REGEX = /^(?:(?:\+|00)213|0)\s*[567]\d{8}$/;

/**
 * Normalise un numéro de téléphone brut.
 *
 * Gère le cas des nombres stockés en float (ex: `799534750.0` → `"0799534750"`)
 * et supprime les espaces/points de groupage.
 *
 * @returns Le numéro normalisé, ou `null` si l'entrée est nulle/undefined.
 */
export function normalizePhone(raw: string): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  // Cas spécial : nombres stockés en float (ex: 799534750.0)
  if (/^\d+(\.\d+)?$/.test(s)) {
    // Si ça commence par un chiffre autre que 0, préfixer 0
    if (!s.startsWith("0") && !s.startsWith("+") && s.length >= 9) {
      s = "0" + s.split(".")[0];
    } else {
      s = s.split(".")[0];
    }
  }
  // Nettoyer espaces et points
  s = s.replace(/[\s.]/g, "");
  return s;
}

/**
 * Valide un numéro de téléphone algérien.
 *
 * @returns `{ valid, normalized }` — `normalized` est `null` si l'entrée
 *          est vide, sinon la chaîne normalisée (même si invalide).
 */
export function validatePhone(raw: string): { valid: boolean; normalized: string | null } {
  const s = normalizePhone(raw);
  if (!s) return { valid: false, normalized: null };
  if (!PHONE_REGEX.test(s)) {
    return { valid: false, normalized: s };
  }
  return { valid: true, normalized: s };
}

/**
 * Valide un numéro ou une liste de numéros (séparés par `/` ou `,`).
 *
 * @returns `RuleIssue` si au moins un numéro est invalide, sinon `null`.
 */
export function phone(value: unknown, field: FieldSpec): RuleIssue | null {
  if (value === null || value === undefined || value === "") return null;
  const parts = String(value)
    .split(/[\/,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return {
      field: field.key,
      header: field.header,
      rule: "phone",
      message: `Numéro de téléphone invalide : « ${value} »`,
    };
  }
  const invalid: string[] = [];
  const normalized: string[] = [];
  for (const p of parts) {
    const r = validatePhone(p);
    if (!r.valid) {
      invalid.push(p);
    } else if (r.normalized !== null) {
      normalized.push(r.normalized);
    }
  }
  if (invalid.length > 0) {
    return {
      field: field.key,
      header: field.header,
      rule: "phone",
      message: `Numéro(s) invalide(s) : ${invalid.join(", ")}`,
    };
  }
  return null;
}

/**
 * Alias de `phone` — valide une liste de numéros.
 *
 * Les appelants qui manipulent des `phoneList` utilisent cette fonction ;
 * la logique est identique à `phone` car les deux formats acceptent
 * plusieurs numéros séparés par `/` ou `,`.
 */
export function phoneList(value: unknown, field: FieldSpec): RuleIssue | null {
  return phone(value, field);
}
