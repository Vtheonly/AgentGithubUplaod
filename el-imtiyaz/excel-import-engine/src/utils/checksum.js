'use strict';

const crypto = require('crypto');
const fs = require('fs');

/**
 * Calcule un checksum SHA-256 du fichier pour détecter les ré-imports
 * du même fichier (idempotence) et stocker une empreinte unique.
 */
function fileChecksum(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

/**
 * Checksum d'un objet (utilisé pour détecter les changements de ligne).
 */
function objectChecksum(obj) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(obj, Object.keys(obj).sort()));
  return hash.digest('hex').slice(0, 16);
}

module.exports = { fileChecksum, objectChecksum };
