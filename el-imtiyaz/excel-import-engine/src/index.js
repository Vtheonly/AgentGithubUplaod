'use strict';

/**
 * API publique du moteur d'import Excel.
 *
 * Usage typique :
 *
 *   const { createEngine } = require('excel-import-engine');
 *   const engine = createEngine({
 *     storage: 'sqlite',
 *     dbPath: './data/import.sqlite',
 *     reportDir: './reports'
 *   });
 *   await engine.init();
 *   engine.on('sheet:progress', ({ sheet, read, total }) => { ... });
 *   const ctx = await engine.importFile('/path/to/file.xlsx');
 *   await engine.close();
 */

const { ImportEngine } = require('./ImportEngine');
const { SCHEMAS, findSchemaByName, findSchemaForSheet, listSchemas } = require('./schemas');
const { SqliteAdapter } = require('./storage/SqliteAdapter');
const { JsonAdapter } = require('./storage/JsonAdapter');
const { StorageAdapter } = require('./storage/StorageAdapter');
const { ExcelParser } = require('./parsers/ExcelParser');
const { SheetDetector } = require('./parsers/SheetDetector');
const { RowValidator } = require('./validators/RowValidator');
const { FieldCoercer } = require('./validators/FieldCoercer');
const { UpsertMatcher } = require('./dedupe/UpsertMatcher');
const { JsonReporter } = require('./reporters/JsonReporter');
const { ExcelReporter } = require('./reporters/ExcelReporter');
const { AuditLogger } = require('./reporters/AuditLogger');
const { ImportContext } = require('./ImportContext');
const errors = require('./errors');

/**
 * Fabrique un moteur d'import configuré.
 * @param {Object} config
 * @param {'sqlite'|'json'|StorageAdapter} config.storage
 * @param {String} [config.dbPath]      — requis si storage='sqlite'
 * @param {String} [config.outputDir]   — requis si storage='json'
 * @param {String} [config.reportDir]   — répertoire où écrire les rapports JSON+Excel
 * @param {Object} [config.parser]      — options passées à ExcelParser
 * @returns {ImportEngine}
 */
function createEngine(config = {}) {
  return new ImportEngine(config);
}

module.exports = {
  // Fabrique
  createEngine,
  // Classe principale (pour usage avancé)
  ImportEngine,
  // Schémas
  SCHEMAS,
  findSchemaByName,
  findSchemaForSheet,
  listSchemas,
  // Composants internes (pour étendre / tester)
  ExcelParser,
  SheetDetector,
  RowValidator,
  FieldCoercer,
  UpsertMatcher,
  JsonReporter,
  ExcelReporter,
  AuditLogger,
  ImportContext,
  // Storage
  StorageAdapter,
  SqliteAdapter,
  JsonAdapter,
  // Erreurs
  ...errors
};
