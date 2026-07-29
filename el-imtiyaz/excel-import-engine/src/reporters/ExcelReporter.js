'use strict';

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * Rapport Excel humain-readable.
 *
 * Produit un fichier .xlsx avec :
 *   - Feuille "Résumé" : statistiques globales du run.
 *   - Feuille "Lignes rejetées" : une ligne par erreur bloquante, avec
 *     toutes les colonnes originales + une colonne "Raison" + "Règle".
 *   - Feuille "Avertissements" : avertissements non bloquants.
 *
 * Ce rapport permet à l'utilisateur de corriger les données source et
 * de relancer l'import.
 */
class ExcelReporter {
  constructor(outputDir) {
    this.outputDir = outputDir;
  }

  async write(context) {
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
    const filePath = path.join(this.outputDir, `import-report-${context.runId}.xlsx`);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'excel-import-engine';
    wb.created = new Date();

    this._writeSummarySheet(wb, context);
    this._writeRejectedSheet(wb, context);
    this._writeWarningsSheet(wb, context);

    await wb.xlsx.writeFile(filePath);
    return { filePath };
  }

  _writeSummarySheet(wb, context) {
    const ws = wb.addWorksheet('Résumé');
    ws.columns = [
      { header: 'Métrique', key: 'metric', width: 35 },
      { header: 'Valeur', key: 'value', width: 50 }
    ];
    ws.getRow(1).font = { bold: true };

    const rows = [
      ['Run ID', context.runId],
      ['Fichier source', context.filePath],
      ['Checksum (SHA-256)', context.fileChecksum],
      ['Taille fichier (octets)', context.fileSize],
      ['Début', context.startedAt.toISOString()],
      ['Fin', context.finishedAt ? context.finishedAt.toISOString() : '—'],
      ['Durée (ms)', context.durationMs],
      ['', ''],
      ['— Statistiques globales —', ''],
      ['Feuilles traitées', context.stats.sheetsProcessed],
      ['Lignes lues', context.stats.rowsRead],
      ['Lignes insérées', context.stats.rowsImported],
      ['Lignes mises à jour', context.stats.rowsUpdated],
      ['Lignes ignorées (doublons)', context.stats.rowsSkipped],
      ['Lignes rejetées (erreurs)', context.stats.rowsRejected],
      ['Avertissements', context.stats.warnings],
      ['', ''],
      ['— Détail par feuille —', '']
    ];
    for (const sr of context.sheetResults) {
      rows.push([`${sr.sheet} (lues)`, sr.rowsRead]);
      rows.push([`${sr.sheet} (insérées)`, sr.rowsImported]);
      rows.push([`${sr.sheet} (mises à jour)`, sr.rowsUpdated]);
      rows.push([`${sr.sheet} (rejetées)`, sr.rowsRejected]);
    }
    rows.forEach(r => ws.addRow({ metric: r[0], value: r[1] }));
  }

  _writeRejectedSheet(wb, context) {
    const ws = wb.addWorksheet('Lignes rejetées');
    ws.columns = [
      { header: 'Feuille', key: 'sheet', width: 18 },
      { header: 'Ligne', key: 'row', width: 8 },
      { header: 'Champ', key: 'field', width: 22 },
      { header: 'En-tête', key: 'header', width: 22 },
      { header: 'Règle', key: 'rule', width: 18 },
      { header: 'Raison', key: 'message', width: 80 }
    ];
    ws.getRow(1).font = { bold: true };

    if (context.errors.length === 0) {
      ws.addRow({ sheet: '—', row: '', field: '', header: '', rule: '', message: 'Aucune erreur. Toutes les lignes valides ont été importées.' });
      return;
    }

    for (const e of context.errors) {
      ws.addRow({
        sheet: e.sheet || '',
        row: e.row ?? e.rowIndex ?? '',
        field: e.field || '',
        header: e.header || '',
        rule: e.rule || '',
        message: e.message || ''
      });
    }
  }

  _writeWarningsSheet(wb, context) {
    const ws = wb.addWorksheet('Avertissements');
    ws.columns = [
      { header: 'Feuille', key: 'sheet', width: 18 },
      { header: 'Ligne', key: 'row', width: 8 },
      { header: 'Champ', key: 'field', width: 22 },
      { header: 'Règle', key: 'rule', width: 18 },
      { header: 'Message', key: 'message', width: 80 }
    ];
    ws.getRow(1).font = { bold: true };

    if (context.warnings.length === 0) {
      ws.addRow({ sheet: '—', row: '', field: '', rule: '', message: 'Aucun avertissement.' });
      return;
    }

    for (const w of context.warnings) {
      ws.addRow({
        sheet: w.sheet || '',
        row: w.row ?? w.rowIndex ?? '',
        field: w.field || '',
        rule: w.rule || '',
        message: w.message || ''
      });
    }
  }
}

module.exports = { ExcelReporter };
