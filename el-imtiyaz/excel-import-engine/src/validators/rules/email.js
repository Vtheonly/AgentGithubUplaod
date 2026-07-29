'use strict';

/**
 * Règle : email basique. Pas une validation RFC 5322 complète — suffisant
 * pour détecter les emails manifestement cassés.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function email(value, field, ctx) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!EMAIL_RE.test(s)) {
    return { rule: 'email', message: `Adresse email invalide : « ${value} »` };
  }
  return null;
}

module.exports = email;
