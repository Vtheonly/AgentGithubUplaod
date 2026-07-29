'use strict';

/**
 * Schéma de la feuille Devis — devis clients.
 * Layout observé :
 *   B2  : nom client
 *   F7  : "Devis n°" + H7 : numéro devis (ex: 0101/2021/2022)
 *   F9  : "Date" + H9 : date
 *   A13 : "Prenom élève" | D13 : "Classe" | E13 : "F I" | F13 : "Frais Scolarisation"
 *         | G13 : "Services" | I13 : "Total"
 *
 * Layout type "formulaire" : un devis par bloc de ~20 lignes.
 * Le moteur détecte les blocs via la présence de "Devis n°" en colonne F.
 */

const DEVIS_SCHEMA = {
  name: 'devis',
  sheetMatchers: [/^DEVIS$/i, /^DEVIS\s/i],
  headerRow: 13,
  requiredHeaders: ['Prenom élève'],
  identity: { fields: ['client', 'devisNumero'], strategy: 'upsert' },
  fields: [
    { key: 'client', header: 'Client', type: 'string', required: true, trim: true, column: 'B', headerRow: 2 },
    { key: 'devisNumero', header: 'Devis n°', type: 'string', required: true, trim: true, column: 'H', headerRow: 7 },
    { key: 'date', header: 'Date', type: 'date', required: false, column: 'H', headerRow: 9 },
    { key: 'prenomEleve', header: 'Prenom élève', type: 'string', required: true, trim: true, column: 'A' },
    { key: 'classe', header: 'Classe', type: 'string', required: false, trim: true, column: 'D' },
    { key: 'fraisInscription', header: 'F I', type: 'numberOrRef', required: false, column: 'E' },
    { key: 'fraisScolarisation', header: 'Frais Scolarisation', type: 'numberOrRef', required: false, column: 'F' },
    { key: 'services', header: 'Services', type: 'numberOrRef', required: false, column: 'G' },
    { key: 'total', header: 'Total', type: 'numberOrRef', required: false, column: 'I' }
  ]
};

module.exports = DEVIS_SCHEMA;
