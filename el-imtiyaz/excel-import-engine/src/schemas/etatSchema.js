'use strict';

/**
 * Schéma de la feuille ETAT 20262027 (feuille principale des élèves/clients).
 * Colonnes (index basés sur l'en-tête R1) :
 *   B  INFOS          — texte libre (optionnel)
 *   C  E-MAIL         — email (optionnel)
 *   D  NEM            — numéro téléphone parent (obligatoire, peut être multi : "06xxx/07xxx")
 *   E  TUTEUR         — code tuteur (optionnel, ex: "NV")
 *   F  NOM            — nom complet élève (obligatoire)
 *   G  niveau         — PRIM | COLG | GS (obligatoire)
 *   H  CLASSE         — CE1, CM2, 3AAM, etc. (obligatoire)
 *   I  OPTION         — TRNSP | vide (optionnel)
 *   J  REMISE         — montant remise (nombre >= 0, défaut 0)
 *   K  JUSTIFICATION  — texte (optionnel)
 *   L  DEVIS ANNUEL   — montant annuel (obligatoire, > 0)
 *   M  REMBOURCEMENT  — montant (optionnel, défaut 0)
 *   N  DETTES         — montant (optionnel, défaut 0)
 *   O..BB REGLEMENTS DETTES — 12 colonnes mensuelles (Sep..Août)
 *
 * Les feuilles ultérieures peuvent ajouter des colonnes ; le moteur
 * se base sur la signature d'en-tête (SheetDetector) plutôt que sur
 * la position fixe.
 */

const ETAT_SCHEMA = {
  name: 'etat',
  sheetMatchers: [/^ETAT/i, /^ETAT\s*\d+/i],
  headerRow: 1,
  requiredHeaders: ['NEM', 'NOM', 'niveau', 'CLASSE', 'DEVIS ANNUEL'],
  identity: { fields: ['NEM', 'NOM'], strategy: 'upsert' },
  fields: [
    { key: 'infos', header: 'INFOS', type: 'string', required: false, trim: true },
    { key: 'email', header: 'E-MAIL', type: 'email', required: false, trim: true },
    { key: 'nem', header: 'NEM', type: 'phoneList', required: true, trim: true },
    { key: 'tuteur', header: 'TUTEUR', type: 'string', required: false, trim: true },
    { key: 'nom', header: 'NOM', type: 'string', required: true, trim: true, minLength: 2 },
    { key: 'niveau', header: 'niveau', type: 'enum', required: true, values: ['PRIM', 'COLG', 'GS', 'LYC'] },
    { key: 'classe', header: 'CLASSE', type: 'string', required: true, trim: true },
    { key: 'option', header: 'OPTION', type: 'enum', required: false, values: ['TRNSP', ''] },
    { key: 'remise', header: 'REMISE', type: 'number', required: false, default: 0, min: 0 },
    { key: 'justification', header: 'JUSTIFICATION', type: 'string', required: false, trim: true },
    { key: 'devisAnnuel', header: 'DEVIS ANNUEL', type: 'number', required: true, min: 0 },
    { key: 'remboursement', header: 'REMBOURCEMENT', type: 'number', required: false, default: 0, min: 0 },
    { key: 'dettes', header: 'DETTES', type: 'number', required: false, default: 0, min: 0 },
    {
      key: 'reglements',
      header: 'REGLEMENTS DETTES',
      type: 'monthlyArray',
      required: false,
      count: 12,
      monthLabels: ['sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug']
    }
  ]
};

module.exports = ETAT_SCHEMA;
