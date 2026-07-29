'use strict';

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

const { ExcelParser } = require('./parsers/ExcelParser');
const { SheetDetector } = require('./parsers/SheetDetector');
const { RowValidator } = require('./validators/RowValidator');
const { UpsertMatcher } = require('./dedupe/UpsertMatcher');
const { JsonReporter } = require('./reporters/JsonReporter');
const { ExcelReporter } = require('./reporters/ExcelReporter');
const { AuditLogger } = require('./reporters/AuditLogger');
const { ImportContext } = require('./ImportContext');
const { defaultLogger: logger } = require('./utils/logger');
const { SCHEMAS, findSchemaByName } = require('./schemas');
const {
  FileNotFoundError,
  ConfigurationError,
  ImportEngineError
} = require('./errors');

/**
 * Moteur d'import principal.
 *
 * API :
 *   const engine = new ImportEngine({ storage: 'sqlite', dbPath: '...' });
 *   await engine.init();
 *   const result = await engine.importFile('/path/to/file.xlsx', { sheets: ['ETAT'] });
 *
 * Événements émis (EventEmitter) :
 *   - 'start'         { runId, filePath }
 *   - 'sheet:start'   { sheet, schema }
 *   - 'sheet:progress'{ sheet, read, total }
 *   - 'sheet:row'     { sheet, row, rowIndex, action }
 *   - 'sheet:warn'    { sheet, warning }
 *   - 'sheet:error'   { sheet, error }
 *   - 'sheet:done'    { sheet, result }
 *   - 'done'          { context }
 *   - 'error'         { error }
 */
class ImportEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.parser = new ExcelParser(config.parser || {});
    this.detector = new SheetDetector();
    this.storage = null;
    this.auditLogger = null;
    this.jsonReporter = config.reportDir ? new JsonReporter(config.reportDir) : null;
    this.excelReporter = config.reportDir ? new ExcelReporter(config.reportDir) : null;
    this._initialized = false;
  }

  /**
   * Initialise l'adaptateur de stockage. Doit être appelé avant importFile.
   */
  async init() {
    if (this._initialized) return;
    if (!this.config.storage) {
      throw new ConfigurationError('Aucun adaptateur de stockage configuré');
    }

    // Si storage est une string, instancie l'adaptateur correspondant
    if (typeof this.config.storage === 'string') {
      this.storage = this._createAdapter(this.config.storage, this.config);
    } else {
      // Peut être une instance déjà configurée
      this.storage = this.config.storage;
    }

    await this.storage.init();
    this.auditLogger = new AuditLogger(this.storage);
    this._initialized = true;
    logger.info('Moteur d\'import initialisé', { storage: this.config.storage });
  }

  _createAdapter(name, config) {
    if (name === 'sqlite') {
      const { SqliteAdapter } = require('./storage/SqliteAdapter');
      return new SqliteAdapter({ dbPath: config.dbPath, verbose: config.verbose });
    }
    if (name === 'json') {
      const { JsonAdapter } = require('./storage/JsonAdapter');
      return new JsonAdapter({ outputDir: config.outputDir || config.reportDir });
    }
    throw new ConfigurationError(`Adaptateur inconnu : ${name}`);
  }

  /**
   * Importe un fichier Excel.
   *
   * @param {String} filePath — chemin absolu vers le .xlsx
   * @param {Object} [options]
   *   @param {String[]}  [options.sheets]      — noms exacts des feuilles à importer (toutes si omis)
   *   @param {String[]}  [options.schemas]     — noms de schémas à traiter (alternative à sheets)
   *   @param {Boolean}   [options.dryRun=false]— valide sans écrire en DB
   *   @param {Boolean}   [options.strict=false]— rejette tout le run si une erreur
   *   @param {String}    [options.reportDir]   — surcharge le répertoire de rapports
   *   @param {Object}    [options.source]      — métadonnées utilisateur (ex: { user: 'admin' })
   * @returns {Promise<ImportContext>}
   */
  async importFile(filePath, options = {}) {
    if (!this._initialized) await this.init();
    if (!fs.existsSync(filePath)) throw new FileNotFoundError(filePath);

    const ctx = new ImportContext({ filePath, options, source: options.source || {} });
    ctx.computeFileMetadata();

    this.emit('start', { runId: ctx.runId, filePath, fileChecksum: ctx.fileChecksum });
    logger.info(`Début import run=${ctx.runId}`, { filePath, checksum: ctx.fileChecksum });

    try {
      const wb = await this.parser.open(filePath);
      const sheets = wb.worksheets;

      // Filtre les feuilles à traiter
      const targetSheets = this._selectSheets(sheets, options);

      if (targetSheets.length === 0) {
        ctx.addWarning({ sheet: null, message: 'Aucune feuille correspondante aux critères' });
      }

      // Démarre une transaction globale
      if (!options.dryRun) await this.storage.beginTransaction();

      try {
        for (const ws of targetSheets) {
          await this._processSheet(ws, ctx, options);
        }
        if (!options.dryRun) await this.storage.commitTransaction();
      } catch (e) {
        if (!options.dryRun) {
          try { await this.storage.rollbackTransaction(); } catch (_) {}
        }
        throw e;
      }

      ctx.finish();

      // Rapports
      const reportDir = options.reportDir || this.config.reportDir;
      const reports = {};
      if (reportDir) {
        fs.mkdirSync(reportDir, { recursive: true });
        if (this.jsonReporter) {
          reports.json = (await new JsonReporter(reportDir).write(ctx)).filePath;
        }
        if (this.excelReporter) {
          reports.excel = (await new ExcelReporter(reportDir).write(ctx)).filePath;
        }
      }

      // Audit log
      if (!options.dryRun && this.auditLogger) {
        await this.auditLogger.saveRun(ctx);
      }

      this.emit('done', { context: ctx, reports });
      logger.info(`Fin import run=${ctx.runId}`, { durationMs: ctx.durationMs, stats: ctx.stats });

      // En mode strict, on rejette si erreurs
      if (options.strict && ctx.errors.length > 0) {
        throw new ImportEngineError(
          `Mode strict : ${ctx.errors.length} erreur(s) — import annulé`,
          'STRICT_MODE_REJECTED',
          { errorsCount: ctx.errors.length }
        );
      }

      return ctx;
    } catch (e) {
      ctx.finish();
      this.emit('error', { error: e, context: ctx });
      logger.error(`Erreur import run=${ctx.runId}`, { message: e.message, code: e.code });
      throw e;
    }
  }

  _selectSheets(allSheets, options) {
    if (options.schemas && options.schemas.length > 0) {
      // Sélection par nom de schéma : on cherche une feuille qui matche
      return allSheets.filter(ws => {
        const schema = this.detector.detect(ws.name);
        return schema && options.schemas.includes(schema.name);
      });
    }
    if (options.sheets && options.sheets.length > 0) {
      return allSheets.filter(ws => options.sheets.includes(ws.name));
    }
    // Par défaut : toutes les feuilles qui matchent un schéma connu
    return allSheets.filter(ws => {
      const schema = this.detector.detect(ws.name);
      return schema !== null;
    });
  }

  async _processSheet(ws, ctx, options) {
    const sheetName = ws.name;
    const schema = this.detector.detect(sheetName);
    if (!schema) {
      ctx.addWarning({ sheet: sheetName, message: `Feuille « ${sheetName} » ignorée (schéma inconnu)` });
      this.emit('sheet:warn', { sheet: sheetName, warning: { message: 'schéma inconnu' } });
      return;
    }

    this.emit('sheet:start', { sheet: sheetName, schema: schema.name });
    logger.info(`Traitement feuille « ${sheetName} » (schéma=${schema.name})`);

    this._currentSchema = schema;
    const validator = new RowValidator(schema);
    const matcher = new UpsertMatcher(schema);

    const sheetResult = {
      sheet: sheetName,
      schema: schema.name,
      rowsRead: 0,
      rowsImported: 0,
      rowsUpdated: 0,
      rowsSkipped: 0,
      rowsRejected: 0
    };

    let processed = 0;

    await this.parser.iterateRows(ws, schema, {
      onRow: async (rawRow, rowIndex) => {
        sheetResult.rowsRead++;
        processed++;

        const { record, errors, warnings, skipped } = validator.validate(rawRow, rowIndex);

        // Journalise les avertissements
        for (const w of warnings) {
          ctx.addWarning({ sheet: sheetName, ...w });
          this.emit('sheet:warn', { sheet: sheetName, warning: w });
        }

        if (skipped) {
          // Ligne rejetée — conserve les erreurs dans le contexte
          for (const e of errors) {
            ctx.addError({ sheet: sheetName, rawValue: rawRow[e.header], ...e });
          }
          sheetResult.rowsRejected++;
          this.emit('sheet:error', { sheet: sheetName, error: errors[0], rowIndex });
          return;
        }

        // Cas spécial : REF est une table de référence (multi-tables)
        if (schema.name === 'ref') {
          await this._insertRefRecord(record, ctx, sheetName, options);
          sheetResult.rowsImported++;
          this.emit('sheet:row', { sheet: sheetName, row: record, rowIndex, action: 'insert' });
          return;
        }

        // Vérifie l'identité (clés d'upsert)
        const identity = matcher.extractIdentity(record);
        if (!identity && matcher.identityFields.length > 0) {
          ctx.addError({
            sheet: sheetName,
            row: rowIndex,
            rule: 'identity',
            message: `Ligne sans identité complète (${matcher.identityFields.join(', ')})`,
            rawValue: JSON.stringify(record).slice(0, 200)
          });
          sheetResult.rowsRejected++;
          return;
        }

        // Upsert dans le stockage
        if (!options.dryRun) {
          // Les adaptateurs sont déclarés `async` (interface uniforme) même si
          // better-sqlite3 est synchrone — on await donc toujours le résultat.
          const r = await this.storage.upsertRecord(schema, record, matcher.identityFields, ctx.runId);
          if (r) {
            if (r.action === 'insert') sheetResult.rowsImported++;
            else if (r.action === 'update') sheetResult.rowsUpdated++;
            else if (r.action === 'skip') sheetResult.rowsSkipped++;
            this.emit('sheet:row', { sheet: sheetName, row: record, rowIndex, action: r.action });
          }
        } else {
          sheetResult.rowsImported++;
          this.emit('sheet:row', { sheet: sheetName, row: record, rowIndex, action: 'dry-run' });
        }
      },
      onProgress: (read, total) => {
        this.emit('sheet:progress', { sheet: sheetName, read, total });
      }
    });

    ctx.addSheetResult(sheetResult);
    this.emit('sheet:done', { sheet: sheetName, result: sheetResult });
    logger.info(`Feuille « ${sheetName} » terminée`, sheetResult);
  }

  async _insertRefRecord(record, ctx, sheetName, options) {
    // REF génère 3 entrées potentielles par ligne : enseignant, classe, localité.
    // Le mapping field.key → (table, column) est défini dans schema.extractAs.
    const extractAs = this._currentSchema && this._currentSchema.extractAs;
    if (!extractAs) return;

    for (const [fieldKey, target] of Object.entries(extractAs)) {
      const value = record[fieldKey];
      if (!value) continue;
      if (!options.dryRun) {
        try {
          await this.storage.insertRecord(target.table, { [target.column]: value });
        } catch (e) {
          ctx.addWarning({ sheet: sheetName, message: `Échec insertion ${target.table}: ${e.message}` });
        }
      }
    }
  }

  /**
   * Liste les feuilles d'un fichier avec leur schéma détecté.
   * Utile pour un aperçu avant import (dry-run).
   */
  async preview(filePath) {
    if (!this._initialized) await this.init();
    return this.parser.listSheets(filePath);
  }

  /**
   * Ferme proprement les ressources (connexion DB, etc.).
   */
  async close() {
    if (this.storage && typeof this.storage.close === 'function') {
      await this.storage.close();
    }
    this._initialized = false;
  }
}

module.exports = { ImportEngine };
