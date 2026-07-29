'use strict';

/**
 * Schéma de la feuille REF — tables de référence (enseignants, classes, localités).
 * Layout observé :
 *   Col A : NOM enseignant (ou vide si continuation)
 *   Col B : code classe (ex: MS, GS, 1AP, CE1, 3AAM)
 *   Col C : (vide)
 *   Col D : localité (ex: BOUMERDES, CORSO, SAHEL...)
 *
 * Trois tables distinctes sont extraites :
 *   - ref_enseignants (col A, dédupliquée)
 *   - ref_classes (col B, dédupliquée)
 *   - ref_localites (col D, dédupliquée)
 */

const REF_SCHEMA = {
  name: 'ref',
  sheetMatchers: [/^REF$/i, /^REFERENCES?$/i],
  headerRow: 0, // pas d'en-tête — données dès la ligne 1
  requiredHeaders: [],
  identity: { fields: [], strategy: 'insert' },
  fields: [
    { key: 'enseignant', header: 'A', type: 'string', required: false, trim: true, column: 1 },
    { key: 'classe', header: 'B', type: 'string', required: false, trim: true, column: 2 },
    { key: 'localite', header: 'D', type: 'string', required: false, trim: true, column: 4 }
  ],
  // Extraction multi-tables : chaque champ est collecté puis dédupliqué
  extractAs: {
    enseignant: { table: 'ref_enseignants', column: 'nom' },
    classe: { table: 'ref_classes', column: 'code' },
    localite: { table: 'ref_localites', column: 'nom' }
  }
};

module.exports = REF_SCHEMA;
