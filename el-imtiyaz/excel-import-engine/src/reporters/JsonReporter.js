'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Rapport JSON machine-readable.
 * Un seul fichier par run, sous <outputDir>/import-report-<runId>.json.
 */
class JsonReporter {
  constructor(outputDir) {
    this.outputDir = outputDir;
  }

  async write(context) {
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
    const filePath = path.join(this.outputDir, `import-report-${context.runId}.json`);
    const payload = context.toJSON();
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return { filePath, summary: this._summary(payload) };
  }

  _summary(ctx) {
    return {
      runId: ctx.runId,
      status: ctx.stats.rowsRejected > 0 ? (ctx.stats.rowsImported > 0 ? 'partial' : 'failed') : 'success',
      durationMs: ctx.durationMs,
      sheets: ctx.sheetResults.map(s => ({ sheet: s.sheet, imported: s.rowsImported, rejected: s.rowsRejected })),
      imported: ctx.stats.rowsImported,
      updated: ctx.stats.rowsUpdated,
      rejected: ctx.stats.rowsRejected,
      warnings: ctx.stats.warnings
    };
  }
}

module.exports = { JsonReporter };
