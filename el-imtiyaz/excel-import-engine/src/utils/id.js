'use strict';

const crypto = require('crypto');

/**
 * Génère un identifiant court et lisible pour un run d'import.
 * Format : run_<timestamp>_<rand6>
 */
function generateRunId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `run_${ts}_${rand}`;
}

/**
 * Génère un UUID v4 simple (sans dépendance externe).
 */
function uuid() {
  return crypto.randomUUID();
}

module.exports = { generateRunId, uuid };
