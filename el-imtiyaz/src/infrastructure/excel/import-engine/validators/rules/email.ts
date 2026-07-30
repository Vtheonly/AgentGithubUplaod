/**
 * Règle : email basique. Pas une validation RFC 5322 complète — suffisant
 * pour détecter les emails manifestement cassés.
 *
 * Ported from `excel-import-engine/src/validators/rules/email.js`.
 */
import type { FieldSpec } from "../../types";
import type { RuleIssue } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Valide qu'une valeur ressemble à une adresse email.
 *
 * @returns `RuleIssue` si la valeur est non vide et invalide, sinon `null`.
 *          Les valeurs vides/null ne déclenchent pas d'erreur (gérées par `required`).
 */
export function email(value: unknown, field: FieldSpec): RuleIssue | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (!EMAIL_RE.test(s)) {
    return {
      field: field.key,
      header: field.header,
      rule: "email",
      message: `Adresse email invalide : « ${value} »`,
    };
  }
  return null;
}
