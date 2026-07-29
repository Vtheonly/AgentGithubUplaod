'use strict';

/**
 * Règle : énumération. Vérifie que la valeur est dans la liste autorisée.
 * Tolérant à la casse et aux espaces.
 */
function enumRule(value, field, ctx) {
  if (value === null || value === undefined || value === '') return null;
  const allowed = (field.values || []).map(v => String(v).trim().toUpperCase());
  const v = String(value).trim().toUpperCase();
  if (!allowed.includes(v)) {
    return {
      rule: 'enum',
      message: `Valeur « ${value} » non autorisée pour « ${field.header || field.key} ». Valeurs attendues : ${field.values.join(', ')}`
    };
  }
  return null;
}

module.exports = enumRule;
