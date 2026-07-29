'use strict';

const { findSchemaForSheet, listSchemas } = require('../schemas');

/**
 * Détecte le schéma applicable à une feuille Excel à partir de son nom
 * et (optionnellement) de sa signature d'en-tête.
 *
 * Stratégie :
 *   1) Match sur le nom de la feuille via les regex `sheetMatchers`.
 *   2) Si pas de match sur le nom, inspecter la signature d'en-tête
 *      (ensemble de headers requis) pour discriminer.
 */
class SheetDetector {
  /**
   * @param {String} sheetName
   * @param {Array<String>} [headerRow] — optionnel : headers de la 1ère ligne
   * @returns {Object|null} schéma trouvé, ou null si inconnu
   */
  detect(sheetName, headerRow = null) {
    // 1) Match par nom
    const byName = findSchemaForSheet(sheetName);
    if (byName) return byName;

    // 2) Match par signature d'en-tête
    if (headerRow && headerRow.length > 0) {
      const normalizedHeaders = headerRow
        .map(h => (h || '').toString().trim().toLowerCase())
        .filter(Boolean);
      for (const schema of listSchemas()) {
        const fullSchema = findSchemaForSheet(schema.name);
        if (!fullSchema.requiredHeaders || fullSchema.requiredHeaders.length === 0) continue;
        const hit = fullSchema.requiredHeaders.every(h =>
          normalizedHeaders.includes(h.toString().trim().toLowerCase())
        );
        if (hit) return fullSchema;
      }
    }

    return null;
  }
}

module.exports = { SheetDetector, defaultDetector: new SheetDetector() };
