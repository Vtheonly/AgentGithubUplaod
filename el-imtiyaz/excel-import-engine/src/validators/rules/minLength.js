'use strict';

/**
 * Règle : longueur minimale de chaîne.
 */
function minLength(value, field, ctx) {
  if (typeof field.minLength !== 'number') return null;
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (s.length < field.minLength) {
    return {
      rule: 'minLength',
      message: `Valeur trop courte (${s.length} < ${field.minLength}) pour « ${field.header || field.key} »`
    };
  }
  return null;
}

module.exports = minLength;
