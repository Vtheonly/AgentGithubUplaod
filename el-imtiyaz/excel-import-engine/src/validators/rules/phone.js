'use strict';

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
 */
const PHONE_REGEX = /^(?:(?:\+|00)213|0)\s*[567]\d{8}$/;

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  // Cas spécial : nombres stockés en float (ex: 799534750.0)
  if (/^\d+(\.\d+)?$/.test(s)) {
    // Si ça commence par un chiffre autre que 0, préfixer 0
    if (!s.startsWith('0') && !s.startsWith('+') && s.length >= 9) {
      s = '0' + s.split('.')[0];
    } else {
      s = s.split('.')[0];
    }
  }
  // Nettoyer espaces et points
  s = s.replace(/[\s.]/g, '');
  return s;
}

function validatePhone(raw) {
  const s = normalizePhone(raw);
  if (!s) return { valid: false, normalized: null };
  if (!PHONE_REGEX.test(s)) {
    return { valid: false, normalized: s };
  }
  return { valid: true, normalized: s };
}

function phone(value, field, ctx) {
  if (value === null || value === undefined || value === '') return null;
  const parts = String(value).split(/[\/,]/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { rule: 'phone', message: `Numéro de téléphone invalide : « ${value} »` };
  }
  const invalid = [];
  const normalized = [];
  for (const p of parts) {
    const r = validatePhone(p);
    if (!r.valid) invalid.push(p);
    else normalized.push(r.normalized);
  }
  if (invalid.length > 0) {
    return {
      rule: 'phone',
      message: `Numéro(s) invalide(s) : ${invalid.join(', ')}`,
      severity: invalid.length === parts.length ? 'error' : 'warn'
    };
  }
  return null;
}

function phoneList(value, field, ctx) {
  return phone(value, field, ctx);
}

module.exports = { phone, phoneList, validatePhone, normalizePhone };
