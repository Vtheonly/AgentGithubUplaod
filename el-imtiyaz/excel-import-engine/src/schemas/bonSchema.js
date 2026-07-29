'use strict';

/**
 * Schéma de la feuille BON — reçus / situations clients.
 * Layout observé (commence à la ligne 4) :
 *   A4 : titre "Situation Client ..."
 *   A7 : "Etat des versements"
 *   E8 : "CLIENT"  | H8 : "DATE"
 *   A10: "DEVIS ANNUEL" | E10: "ELEVES" | G10: "DEVIS" | H10: "TOTAL VERSE" | I10: "RESTE VERSE"
 *   A13: "INSCRIPTION"
 *   Lignes de détail à partir de la ligne 12 (col E : nom élève, G/H/I : montants)
 *
 * Cette feuille contient souvent des #REF! (formules cassées). Le moteur
 * ignore les lignes dont les montants sont #REF! et les journalise comme
 * avertissements plutôt que comme erreurs fatales.
 */

const BON_SCHEMA = {
  name: 'bon',
  sheetMatchers: [/^BON\s*$/i, /^BONS?$/i],
  headerRow: 10, // ligne d'en-tête de la zone de données
  dataStartRow: 12,
  requiredHeaders: ['ELEVES'],
  identity: { fields: ['eleve'], strategy: 'upsert' },
  fields: [
    { key: 'client', header: 'CLIENT', type: 'string', required: false, trim: true, column: 'E', headerRow: 8 },
    { key: 'date', header: 'DATE', type: 'date', required: false, column: 'H', headerRow: 8 },
    { key: 'devisAnnuel', header: 'DEVIS ANNUEL', type: 'number', required: false, column: 'A', headerRow: 10 },
    { key: 'eleve', header: 'ELEVES', type: 'string', required: true, trim: true, column: 'E' },
    { key: 'devis', header: 'DEVIS', type: 'numberOrRef', required: false, column: 'G' },
    { key: 'totalVerse', header: 'TOTAL VERSE', type: 'numberOrRef', required: false, column: 'H' },
    { key: 'resteVerse', header: 'RESTE VERSE', type: 'numberOrRef', required: false, column: 'I' }
  ]
};

module.exports = BON_SCHEMA;
