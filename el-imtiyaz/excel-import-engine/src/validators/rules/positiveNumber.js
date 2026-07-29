'use strict';

/**
 * Règle : nombre positif.
 * Accepte nombre, chaîne numérique, et chaîne avec séparateurs FR (espace, virgule).
 */
function parseNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  // Détecter #REF! ou autres erreurs Excel
  if (/^#REF!|^#N\/A|^#VALUE!|^#NAME\?|^#DIV\/0!|^#NULL!|^#NUM!$/.test(s)) {
    return { error: 'ref', raw: s };
  }
  // Retirer espaces fines et insécables
  s = s.replace(/[\s\u00A0]/g, '').replace(/\s/g, '');
  // Remplacer virgule décimale
  s = s.replace(',', '.');
  // Retirer éventuels symboles monétaires
  s = s.replace(/[DA€$]/gi, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  if (Number.isNaN(n)) return { error: 'nan', raw };
  return n;
}

function positiveNumber(value, field, ctx) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseNumber(value);
  if (parsed && parsed.error) {
    return { rule: 'positiveNumber', message: `Valeur numérique invalide : « ${value} »` };
  }
  if (parsed === null) return null;
  if (typeof field.min === 'number' && parsed < field.min) {
    return {
      rule: 'positiveNumber',
      message: `Valeur ${parsed} inférieure au minimum ${field.min} pour « ${field.header || field.key} »`
    };
  }
  if (typeof field.max === 'number' && parsed > field.max) {
    return {
      rule: 'positiveNumber',
      message: `Valeur ${parsed} supérieure au maximum ${field.max} pour « ${field.header || field.key} »`
    };
  }
  return null;
}

module.exports = { positiveNumber, parseNumber };
