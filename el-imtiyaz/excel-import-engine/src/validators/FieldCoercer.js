'use strict';

const required = require('./rules/required');
const { phone, phoneList, normalizePhone } = require('./rules/phone');
const { positiveNumber, parseNumber } = require('./rules/positiveNumber');
const enumRule = require('./rules/enum');
const emailRule = require('./rules/email');
const minLength = require('./rules/minLength');

/**
 * Coerce une valeur brute Excel vers le type déclaré dans le schéma,
 * et applique les règles de validation associées.
 *
 * @returns {{ value: any, errors: Array, warnings: Array }}
 *          - value : valeur coercée (ou null si invalide/absente)
 *          - errors : tableau d'erreurs { rule, message }
 *          - warnings : tableau d'avertissements
 */
class FieldCoercer {
  coerce(rawValue, field) {
    const errors = [];
    const warnings = [];

    // 1) Cas erreur de formule Excel (#REF!, #N/A, etc.)
    if (this._isExcelError(rawValue)) {
      if (field.required) {
        errors.push({
          rule: 'excelError',
          message: `Erreur de formule Excel « ${rawValue} » dans le champ obligatoire « ${field.header || field.key} »`
        });
      } else {
        warnings.push({
          rule: 'excelError',
          message: `Erreur de formule Excel « ${rawValue} » ignorée dans « ${field.header || field.key} »`
        });
      }
      return { value: null, errors, warnings };
    }

    // 2) Required check (avant coercion)
    const reqErr = required(rawValue, field);
    if (reqErr) {
      errors.push(reqErr);
      return { value: field.default !== undefined ? field.default : null, errors, warnings };
    }

    // 3) Si valeur vide et champ optionnel, utiliser la valeur par défaut
    if (rawValue === null || rawValue === undefined || (typeof rawValue === 'string' && rawValue.trim() === '')) {
      return { value: field.default !== undefined ? field.default : null, errors, warnings };
    }

    // 4) Coercition par type
    let coercedValue = rawValue;
    switch (field.type) {
      case 'string':
        coercedValue = field.trim ? String(rawValue).trim() : String(rawValue);
        if (field.uppercase) coercedValue = coercedValue.toUpperCase();
        if (field.lowercase) coercedValue = coercedValue.toLowerCase();
        break;

      case 'email': {
        const e = emailRule(rawValue, field);
        if (e) errors.push(e);
        else coercedValue = String(rawValue).trim().toLowerCase();
        break;
      }

      case 'phone':
      case 'phoneList': {
        const e = field.type === 'phoneList'
          ? phoneList(rawValue, field)
          : phone(rawValue, field);
        if (e) {
          if (e.severity === 'warn') warnings.push(e);
          else errors.push(e);
        } else {
          const parts = String(rawValue).split(/[\/,]/).map(s => s.trim()).filter(Boolean);
          coercedValue = parts.map(normalizePhone);
          if (field.type === 'phone' && Array.isArray(coercedValue)) {
            coercedValue = coercedValue[0] || null;
          }
        }
        break;
      }

      case 'number':
      case 'numberOrRef': {
        const parsed = parseNumber(rawValue);
        if (parsed && parsed.error) {
          if (field.type === 'numberOrRef') {
            // Tolérant : on log en warning et on garde null
            warnings.push({
              rule: 'numberOrRef',
              message: `Valeur « ${rawValue} » traitée comme référence dans « ${field.header || field.key} »`
            });
            coercedValue = null;
          } else {
            errors.push({
              rule: 'number',
              message: `Valeur numérique invalide : « ${rawValue} »`
            });
            coercedValue = null;
          }
        } else if (parsed === null) {
          coercedValue = field.default !== undefined ? field.default : null;
        } else {
          const e = positiveNumber(parsed, field);
          if (e) errors.push(e);
          coercedValue = parsed;
        }
        break;
      }

      case 'enum': {
        const e = enumRule(rawValue, field);
        if (e) errors.push(e);
        else coercedValue = String(rawValue).trim().toUpperCase();
        break;
      }

      case 'date': {
        if (rawValue instanceof Date) {
          coercedValue = rawValue;
        } else {
          const d = new Date(rawValue);
          if (Number.isNaN(d.getTime())) {
            warnings.push({
              rule: 'date',
              message: `Date invalide « ${rawValue} » dans « ${field.header || field.key} »`
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

    // 5) Règles structurelles (minLength, etc.)
    if (field.type === 'string' || field.type === 'email') {
      const e = minLength(coercedValue, field);
      if (e) errors.push(e);
    }

    return { value: coercedValue, errors, warnings };
  }

  _isExcelError(v) {
    if (typeof v !== 'string') return false;
    return /^#REF!|^#N\/A|^#VALUE!|^#NAME\?|^#DIV\/0!|^#NULL!|^#NUM!$/.test(v.trim());
  }
}

module.exports = { FieldCoercer, defaultCoercer: new FieldCoercer() };
