'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { StorageError } = require('../errors');
const { objectChecksum } = require('../utils/checksum');

/**
 * Adaptateur SQLite (better-sqlite3).
 *
 * better-sqlite3 est SYNCHRONE — les méthodes sont donc synchrones,
 * mais on garde l'interface async pour compatibilité avec l'StorageAdapter.
 *
 * Avantages :
 *   - Très rapide (10-100x plus rapide que sqlite3 async pour des batchs).
 *   - Transactions natives via db.transaction().
 *   - Pas de dépendance native côté runtime (compile avec prebuilds).
 *
 * Inconvénients :
 *   - Synchrone, bloque l'event loop. Pour des imports de >50k lignes,
 *     il faut soit segmenter, soit utiliser worker_threads.
 */
class SqliteAdapter {
  /**
   * @param {Object} config
   * @param {String} config.dbPath — chemin vers le fichier .sqlite (ou ':memory:')
   * @param {Boolean} [config.verbose=false]
   */
  constructor(config = {}) {
    if (!config.dbPath) throw new StorageError('SqliteAdapter: dbPath requis');
    this.dbPath = config.dbPath;
    this.verbose = config.verbose || false;
    this.db = null;
    this._schemaPath = path.join(__dirname, 'schema.sql');
  }

  async init() {
    try {
      this.db = new Database(this.dbPath, { verbose: this.verbose ? (msg) => process.stderr.write(`[sqlite] ${msg}\n`) : undefined });
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');

      const sql = fs.readFileSync(this._schemaPath, 'utf8');
      this.db.exec(sql);
    } catch (e) {
      throw new StorageError(`Échec init SQLite: ${e.message}`, { cause: e.message });
    }
  }

  async beginTransaction() {
    this._tx = this.db.transaction(() => {});
    // Note : on n'appelle pas _tx immédiatement ; on commit via commitTransaction
    // Approche alternative : utiliser BEGIN/COMMIT explicites
    this.db.exec('BEGIN');
  }

  async commitTransaction() {
    this.db.exec('COMMIT');
    this._tx = null;
  }

  async rollbackTransaction() {
    try { this.db.exec('ROLLBACK'); } catch (_) {}
    this._tx = null;
  }

  /**
   * Upsert générique basé sur le schéma.
   * @param {Object} schema — schéma de feuille
   * @param {Object} record — record coercé
   * @param {String[]} identityKeys — clés d'identité (ex: ['nem', 'nom'])
   * @param {String} runId — ID du run courant
   * @returns {{ action: 'insert'|'update'|'skip', id: Number }}
   */
  async upsertRecord(schema, record, identityKeys, runId) {
    if (!schema || schema.name === 'etat') {
      return this._upsertEtat(record, runId);
    }
    if (schema.name === 'bon') {
      return this._upsertBon(record, runId);
    }
    if (schema.name === 'devis') {
      return this._upsertDevis(record, runId);
    }
    // Fallback : insert simple
    return this.insertRecord(schema.name, record);
  }

  _upsertEtat(record, runId) {
    const now = new Date().toISOString();
    const nemStr = Array.isArray(record.nem) ? record.nem.join(',') : (record.nem || '');
    const nemNorm = Array.isArray(record.nem) ? record.nem[0] : record.nem;
    const checksum = objectChecksum(record);
    const reglementsJson = record.reglements ? JSON.stringify(record.reglements) : null;

    // Cherche existant
    const existing = this.db.prepare('SELECT id, checksum FROM etat_clients WHERE nem = ? AND nom = ?').get(nemStr, record.nom);

    if (existing) {
      if (existing.checksum === checksum) {
        // Pas de changement
        return { action: 'skip', id: existing.id };
      }
      this.db.prepare(`
        UPDATE etat_clients SET
          infos = ?, email = ?, nem_normalized = ?, tuteur = ?, niveau = ?, classe = ?,
          option = ?, remise = ?, justification = ?, devis_annuel = ?, remboursement = ?,
          dettes = ?, reglements_json = ?,
          last_updated_run_id = ?, last_updated_at = ?, checksum = ?
        WHERE id = ?
      `).run(
        record.infos || null, record.email || null, nemNorm || null,
        record.tuteur || null, record.niveau || null, record.classe || null,
        record.option || null, record.remise ?? 0, record.justification || null,
        record.devisAnnuel ?? 0, record.remboursement ?? 0, record.dettes ?? 0,
        reglementsJson,
        runId, now, checksum,
        existing.id
      );
      return { action: 'update', id: existing.id };
    }

    const info = this.db.prepare(`
      INSERT INTO etat_clients (
        infos, email, nem, nem_normalized, tuteur, nom, niveau, classe, option,
        remise, justification, devis_annuel, remboursement, dettes, reglements_json,
        first_imported_run_id, first_imported_at, last_updated_run_id, last_updated_at, checksum
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.infos || null, record.email || null, nemStr, nemNorm || null,
      record.tuteur || null, record.nom, record.niveau, record.classe, record.option || null,
      record.remise ?? 0, record.justification || null, record.devisAnnuel ?? 0,
      record.remboursement ?? 0, record.dettes ?? 0, reglementsJson,
      runId, now, runId, now, checksum
    );
    return { action: 'insert', id: info.lastInsertRowid };
  }

  _upsertBon(record, runId) {
    const now = new Date().toISOString();
    const checksum = objectChecksum(record);
    const dateStr = record.date instanceof Date ? record.date.toISOString() : (record.date || null);
    const clientVal = record.client || null;
    const eleveVal = record.eleve;

    // Cherche existant : match sur eleve + client (client peut être NULL)
    const existing = clientVal
      ? this.db.prepare('SELECT id, checksum FROM bons WHERE eleve = ? AND client = ?').get(eleveVal, clientVal)
      : this.db.prepare('SELECT id, checksum FROM bons WHERE eleve = ? AND client IS NULL').get(eleveVal);

    if (existing) {
      if (existing.checksum === checksum) return { action: 'skip', id: existing.id };
      this.db.prepare(`
        UPDATE bons SET client = ?, date = ?, devis_annuel = ?, devis = ?, total_verse = ?, reste_verse = ?,
          last_updated_run_id = ?, last_updated_at = ?, checksum = ? WHERE id = ?
      `).run(clientVal, dateStr, record.devisAnnuel ?? null, record.devis ?? null,
            record.totalVerse ?? null, record.resteVerse ?? null,
            runId, now, checksum, existing.id);
      return { action: 'update', id: existing.id };
    }

    const info = this.db.prepare(`
      INSERT INTO bons (client, date, devis_annuel, eleve, devis, total_verse, reste_verse,
        first_imported_run_id, first_imported_at, last_updated_run_id, last_updated_at, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientVal, dateStr, record.devisAnnuel ?? null, eleveVal,
           record.devis ?? null, record.totalVerse ?? null, record.resteVerse ?? null,
           runId, now, runId, now, checksum);
    return { action: 'insert', id: info.lastInsertRowid };
  }

  _upsertDevis(record, runId) {
    const now = new Date().toISOString();
    const checksum = objectChecksum(record);
    const dateStr = record.date instanceof Date ? record.date.toISOString() : (record.date || null);

    const existing = this.db.prepare('SELECT id, checksum FROM devis WHERE client = ? AND devis_numero = ?')
      .get(record.client, record.devisNumero);

    if (existing) {
      if (existing.checksum === checksum) return { action: 'skip', id: existing.id };
      this.db.prepare(`
        UPDATE devis SET date = ?, prenom_eleve = ?, classe = ?, frais_inscription = ?,
          frais_scolarisation = ?, services = ?, total = ?,
          last_updated_run_id = ?, last_updated_at = ?, checksum = ? WHERE id = ?
      `).run(dateStr, record.prenomEleve, record.classe || null,
             record.fraisInscription ?? null, record.fraisScolarisation ?? null,
             record.services ?? null, record.total ?? null,
             runId, now, checksum, existing.id);
      return { action: 'update', id: existing.id };
    }

    const info = this.db.prepare(`
      INSERT INTO devis (client, devis_numero, date, prenom_eleve, classe,
        frais_inscription, frais_scolarisation, services, total,
        first_imported_run_id, first_imported_at, last_updated_run_id, last_updated_at, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.client, record.devisNumero, dateStr, record.prenomEleve, record.classe || null,
           record.fraisInscription ?? null, record.fraisScolarisation ?? null,
           record.services ?? null, record.total ?? null,
           runId, now, runId, now, checksum);
    return { action: 'insert', id: info.lastInsertRowid };
  }

  /**
   * Insert simple (sans upsert) — utilisé pour les tables de référence
   * qui sont dédupliquées par UNIQUE constraint.
   */
  async insertRecord(table, record) {
    const col = Object.keys(record)[0];
    if (!col) return { action: 'skip', id: null };
    try {
      const info = this.db.prepare(`INSERT OR IGNORE INTO ${table} (${col}) VALUES (?)`).run(record[col]);
      return { action: info.changes > 0 ? 'insert' : 'skip', id: info.lastInsertRowid };
    } catch (e) {
      throw new StorageError(`insertRecord ${table}: ${e.message}`, { table, record });
    }
  }

  async saveAuditRun(context) {
    const stats = context.stats;
    const status = stats.rowsRejected > 0 ? (stats.rowsImported > 0 ? 'partial' : 'failed') : 'success';
    this.db.prepare(`
      INSERT OR REPLACE INTO import_runs (
        run_id, file_path, file_checksum, file_size, started_at, finished_at,
        duration_ms, options_json, source_json, stats_json, sheet_results_json,
        errors_count, warnings_count, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      context.runId,
      context.filePath,
      context.fileChecksum,
      context.fileSize,
      context.startedAt.toISOString(),
      context.finishedAt ? context.finishedAt.toISOString() : null,
      context.durationMs,
      JSON.stringify(context.options),
      JSON.stringify(context.source),
      JSON.stringify(stats),
      JSON.stringify(context.sheetResults),
      context.errors.length,
      context.warnings.length,
      status
    );

    // Insère les erreurs détaillées (par batch de 500)
    const insertError = this.db.prepare(`
      INSERT INTO import_errors (run_id, sheet, row_index, field, header, rule, message, severity, raw_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const allEntries = [
      ...context.errors.map(e => ({ ...e, severity: 'error' })),
      ...context.warnings.map(w => ({ ...w, severity: 'warn' }))
    ];
    const insertMany = this.db.transaction((rows) => {
      for (const r of rows) {
        insertError.run(
          context.runId,
          r.sheet || null,
          r.row ?? r.rowIndex ?? null,
          r.field || null,
          r.header || null,
          r.rule || null,
          r.message || null,
          r.severity,
          r.rawValue !== undefined ? String(r.rawValue).slice(0, 500) : null
        );
      }
    });
    insertMany(allEntries);
    return { status, errorsCount: allEntries.length };
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { SqliteAdapter };
