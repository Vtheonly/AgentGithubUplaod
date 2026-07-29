'use strict';

const ETAT_SCHEMA = require('./etatSchema');
const BON_SCHEMA = require('./bonSchema');
const DEVIS_SCHEMA = require('./devisSchema');
const REF_SCHEMA = require('./refSchema');

/**
 * Registre central des schémas. L'ordre a une importance : lors de la
 * détection automatique, les schémas sont testés dans cet ordre.
 */
const SCHEMAS = [ETAT_SCHEMA, REF_SCHEMA, BON_SCHEMA, DEVIS_SCHEMA];

function findSchemaByName(name) {
  return SCHEMAS.find(s => s.name === name);
}

function findSchemaForSheet(sheetName) {
  return SCHEMAS.find(s => s.sheetMatchers.some(re => re.test(sheetName)));
}

function listSchemas() {
  return SCHEMAS.map(s => ({ name: s.name, matchers: s.sheetMatchers }));
}

module.exports = {
  SCHEMAS,
  ETAT_SCHEMA,
  BON_SCHEMA,
  DEVIS_SCHEMA,
  REF_SCHEMA,
  findSchemaByName,
  findSchemaForSheet,
  listSchemas
};
