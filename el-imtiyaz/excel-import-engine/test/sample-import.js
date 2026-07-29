'use strict';

/**
 * Script de démonstration — importe le fichier Excel « Suivis clients 2026_2027 »
 * fourni dans /home/z/my-project/upload/ et affiche le résumé.
 *
 * Exécution :
 *   cd /home/z/my-project/download/excel-import-engine
 *   node test/sample-import.js
 */

const path = require('path');
const fs = require('fs');
const { createEngine } = require('../src/index');

const INPUT_FILE = process.argv[2] || '/home/z/my-project/upload/Suivis clients  2026_2027 .xlsx';
const DB_PATH = path.join(__dirname, 'data', 'import.sqlite');
const REPORT_DIR = path.join(__dirname, 'output');

async function main() {
  // Nettoie les artefacts du run précédent pour une démo propre
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  if (fs.existsSync(REPORT_DIR)) {
    fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Fichier d'entrée introuvable : ${INPUT_FILE}`);
    process.exit(1);
  }

  console.log('=== Démonstration du moteur d\'import Excel ===');
  console.log(`Fichier source : ${INPUT_FILE}`);
  console.log(`Base SQLite    : ${DB_PATH}`);
  console.log(`Rapports       : ${REPORT_DIR}`);
  console.log('');

  const engine = createEngine({
    storage: 'sqlite',
    dbPath: DB_PATH,
    reportDir: REPORT_DIR,
    verbose: false
  });

  // --- Événements pour feedback live ---
  engine.on('start', ({ runId, filePath }) => {
    console.log(`[START] run=${runId} file=${path.basename(filePath)}`);
  });

  engine.on('sheet:start', ({ sheet, schema }) => {
    console.log(`  → Feuille « ${sheet} » (schéma=${schema}) ...`);
  });

  engine.on('sheet:progress', ({ sheet, read, total }) => {
    if (read % 100 === 0 || read === total) {
      const pct = total ? Math.round((read / total) * 100) : 0;
      process.stdout.write(`\r     ${sheet} : ${read}/${total} lignes (${pct}%)`);
      if (read === total) process.stdout.write('\n');
    }
  });

  engine.on('sheet:warn', ({ sheet, warning }) => {
    // Silencieux : agrégé dans le rapport
  });

  engine.on('sheet:error', ({ sheet, error, rowIndex }) => {
    // Silencieux : agrégé dans le rapport
  });

  engine.on('sheet:done', ({ sheet, result }) => {
    console.log(`     ✓ ${result.rowsImported} insérées, ${result.rowsUpdated} mises à jour, ${result.rowsSkipped} ignorées, ${result.rowsRejected} rejetées`);
  });

  engine.on('done', ({ context, reports }) => {
    console.log('');
    console.log('=== Import terminé ===');
    console.log(`Run ID    : ${context.runId}`);
    console.log(`Durée     : ${context.durationMs} ms`);
    console.log(`Checksum  : ${context.fileChecksum?.slice(0, 16)}...`);
    console.log('');
    console.log('Statistiques globales :');
    console.log(`  Feuilles traitées : ${context.stats.sheetsProcessed}`);
    console.log(`  Lignes lues       : ${context.stats.rowsRead}`);
    console.log(`  Lignes insérées   : ${context.stats.rowsImported}`);
    console.log(`  Lignes mises à jour: ${context.stats.rowsUpdated}`);
    console.log(`  Lignes ignorées   : ${context.stats.rowsSkipped}`);
    console.log(`  Lignes rejetées   : ${context.stats.rowsRejected}`);
    console.log(`  Avertissements    : ${context.stats.warnings}`);
    console.log('');
    if (reports.json) console.log(`Rapport JSON  : ${reports.json}`);
    if (reports.excel) console.log(`Rapport Excel : ${reports.excel}`);
  });

  try {
    await engine.init();

    // Étape 1 : aperçu
    console.log('--- Aperçu des feuilles ---');
    const preview = await engine.preview(INPUT_FILE);
    for (const s of preview) {
      console.log(`  ${s.name.padEnd(20)} rows=${String(s.rowCount).padStart(5)}  schema=${s.schema ? s.schema.name : '(inconnu)'}`);
    }
    console.log('');

    // Étape 2 : import réel
    console.log('--- Import ---');
    const ctx = await engine.importFile(INPUT_FILE, {
      dryRun: false,
      source: { user: 'demo', triggeredBy: 'sample-import.js' }
    });

    // Vérification : compte les enregistrements en base
    console.log('');
    console.log('--- Comptages en base ---');
    const db = engine.storage.db;
    const tables = ['etat_clients', 'bons', 'devis', 'ref_enseignants', 'ref_classes', 'ref_localites', 'import_runs'];
    for (const t of tables) {
      try {
        const r = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
        console.log(`  ${t.padEnd(20)} ${r.n} enregistrement(s)`);
      } catch (e) {
        console.log(`  ${t.padEnd(20)} (table absente)`);
      }
    }

    // Affiche 3 exemples de rejets
    if (ctx.errors.length > 0) {
      console.log('');
      console.log('--- Exemples de rejets (3 premiers) ---');
      for (const e of ctx.errors.slice(0, 3)) {
        console.log(`  [${e.sheet} R${e.row}] ${e.rule}: ${e.message}`);
        if (e.rawValue) console.log(`     valeur brute: ${String(e.rawValue).slice(0, 80)}`);
      }
    }

    // Affiche 3 exemples d'avertissements
    if (ctx.warnings.length > 0) {
      console.log('');
      console.log('--- Exemples d\'avertissements (3 premiers) ---');
      for (const w of ctx.warnings.slice(0, 3)) {
        console.log(`  [${w.sheet}] ${w.rule}: ${w.message}`);
      }
    }

    await engine.close();
    console.log('');
    console.log('✓ Démonstration terminée avec succès.');
    process.exit(0);
  } catch (e) {
    console.error('');
    console.error('✗ Échec de l\'import :', e.message);
    if (e.details) console.error('  Détails :', JSON.stringify(e.details));
    console.error(e.stack);
    await engine.close().catch(() => {});
    process.exit(1);
  }
}

main();
