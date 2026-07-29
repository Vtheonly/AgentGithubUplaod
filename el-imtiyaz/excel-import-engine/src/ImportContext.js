'use strict';

const { generateRunId } = require('./utils/id');
const { fileChecksum } = require('./utils/checksum');

/**
 * État d'un run d'import. Un ImportContext est créé par appel à
 * ImportEngine#importFile(). Il est immuable hormis les compteurs
 * qui sont mis à jour au fur et à mesure.
 *
 * Thread-safety : non — un contexte est lié à un run unique et
 * n'est pas partagé entre plusieurs imports concurrents.
 */
class ImportContext {
  constructor({ filePath, options, source }) {
    this.runId = generateRunId();
    this.startedAt = new Date();
    this.finishedAt = null;
    this.filePath = filePath;
    this.options = options || {};
    this.source = source || {}; // métadonnées optionnelles (utilisateur, origine, etc.)

    // Calculé à l'ouverture du fichier
    this.fileChecksum = null;
    this.fileSize = 0;

    // Compteurs agrégés
    this.stats = {
      sheetsProcessed: 0,
      rowsRead: 0,
      rowsImported: 0,
      rowsUpdated: 0,
      rowsSkipped: 0,
      rowsRejected: 0,
      warnings: 0
    };

    // Détail par feuille
    this.sheetResults = [];

    // Erreurs et avertissements détaillés
    this.errors = [];
    this.warnings = [];
  }

  addError(entry) {
    this.errors.push({ runId: this.runId, ...entry });
    this.stats.rowsRejected++;
  }

  addWarning(entry) {
    this.warnings.push({ runId: this.runId, ...entry });
    this.stats.warnings++;
  }

  addSheetResult(result) {
    this.sheetResults.push(result);
    this.stats.sheetsProcessed++;
    this.stats.rowsRead += result.rowsRead || 0;
    this.stats.rowsImported += result.rowsImported || 0;
    this.stats.rowsUpdated += result.rowsUpdated || 0;
    this.stats.rowsSkipped += result.rowsSkipped || 0;
    this.stats.rowsRejected += result.rowsRejected || 0;
  }

  finish() {
    this.finishedAt = new Date();
    this.durationMs = this.finishedAt - this.startedAt;
  }

  computeFileMetadata() {
    if (this.filePath) {
      try {
        this.fileChecksum = fileChecksum(this.filePath);
        const fs = require('fs');
        this.fileSize = fs.statSync(this.filePath).size;
      } catch {
        // fichier peut être un buffer ; ignoré silencieusement
      }
    }
  }

  toJSON() {
    return {
      runId: this.runId,
      filePath: this.filePath,
      fileChecksum: this.fileChecksum,
      fileSize: this.fileSize,
      startedAt: this.startedAt.toISOString(),
      finishedAt: this.finishedAt ? this.finishedAt.toISOString() : null,
      durationMs: this.durationMs,
      options: this.options,
      source: this.source,
      stats: this.stats,
      sheetResults: this.sheetResults,
      errors: this.errors,
      warnings: this.warnings
    };
  }
}

module.exports = { ImportContext };
