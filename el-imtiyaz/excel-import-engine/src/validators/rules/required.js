'use strict';

/**
 * Règle : champ obligatoire. Vérifie que la valeur n'est pas nulle,
 * undefined, ou une chaîne vide après trim.
 */
function required(value, field, ctx) {
  if (field.required === false) return null;
  if (value === null || value === undefined) {
    return { rule: 'required', message: `Champ obligatoire manquant : « ${field.header || field.key} »` };
  }
  if (typeof value === 'string' && value.trim() === '') {
    return { rule: 'required', message: `Champ obligatoire vide : « ${field.header || field.key} »` };
  }
  return null;
}

module.exports = required;
