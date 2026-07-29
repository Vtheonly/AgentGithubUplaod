'use strict';

const fs = require('fs');
const path = require('path');
const { StorageError } = require('../errors');
const { objectChecksum } = require('../utils/checksum');

/**
 * Adaptateur JSON simple.
 *
 * Un fichier par table, sous <outputDir>/<table>.json.
 * Convient pour :
 *   - Inspection humaine facile (debug).
 *   - Export vers d'autres systèmes.
 *   - Tests unitaires (pas de dépendance native).
 *
 * Ne convient PAS pour :
 *   - Volumétrie > 10 000 lignes (recharge le fichier entier à chaque upsert).
 *   - Concurrency (pas de locking).
 */
class JsonAdapter {
  constructor(config = {}) {
    if (!config.outputDir) throw new StorageError('JsonAdapter: outputDir requis');
    this.outputDir = config.outputDir;
    this._tables = {}; // cache mémoire : { tableName: [{ id, ...record }] }
    this._nextId = {}; // compteur d'ID par table
  }

  async init() {
    fs.mkdirSync(this.outputDir, { recursive: true });
    // Charge les tables existantes
    const files = fs.readdirSync(this.outputDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const table = f.replace('.json', '');
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.outputDir, f), 'utf8'));
        this._tables[table] = Array.isArray(data) ? data : [];
        this._nextId[table] = this._tables[table].reduce((m, r) => Math.max(m, r.id || 0), 0);
      } catch (e) {
        this._tables[table] = [];
        this._nextId[table] = 0;
      }
    }
  }

  async beginTransaction() { /* no-op */ }
  async commitTransaction() {
    // Flush toutes les tables modifiées sur disque
    for (const table of Object.keys(this._tables)) {
      this._persist(table);
    }
  }
  async rollbackTransaction() { /* no-op : on n'a pas de snapshot */ }

  async upsertRecord(schema, record, identityKeys, runId) {
    const table = this._tableForSchema(schema);
    if (!this._tables[table]) {
      this._tables[table] = [];
      this._nextId[table] = 0;
    }
    const now = new Date().toISOString();
    const checksum = objectChecksum(record);

    if (schema.name === 'ref') {
      // REF est géré via insertRecord (multi-tables)
      return this.insertRecord(table, record);
    }

    // Cherche existant par clés d'identité
    const existingIdx = this._tables[table].findIndex(r =>
      identityKeys.every(k => r[this._toCamel(k)] === record[k])
    );

    if (existingIdx >= 0) {
      const existing = this._tables[table][existingIdx];
      if (existing.checksum === checksum) return { action: 'skip', id: existing.id };
      this._tables[table][existingIdx] = {
        ...existing,
        ...record,
        last_updated_run_id: runId,
        last_updated_at: now,
        checksum
      };
      return { action: 'update', id: existing.id };
    }

    const id = ++this._nextId[table];
    this._tables[table].push({
      id,
      ...record,
      first_imported_run_id: runId,
      first_imported_at: now,
      last_updated_run_id: runId,
      last_updated_at: now,
      checksum
    });
    return { action: 'insert', id };
  }

  async insertRecord(table, record) {
    if (!this._tables[table]) {
      this._tables[table] = [];
      this._nextId[table] = 0;
    }
    // Déduplique par valeur (premier champ du record)
    const key = Object.keys(record)[0];
    const val = record[key];
    if (val && this._tables[table].some(r => r[key] === val)) {
      return { action: 'skip', id: null };
    }
    const id = ++this._nextId[table];
    this._tables[table].push({ id, ...record });
    return { action: 'insert', id };
  }

  async saveAuditRun(context) {
    const auditTable = 'import_runs';
    if (!this._tables[auditTable]) this._tables[auditTable] = [];
    this._tables[auditTable].push(context.toJSON());
    this._persist(auditTable);

    // Persiste aussi les tables de données
    for (const t of Object.keys(this._tables)) {
      if (t !== auditTable) this._persist(t);
    }
    return { status: context.stats.rowsRejected > 0 ? 'partial' : 'success', errorsCount: context.errors.length };
  }

  async close() {
    // Flush final
    for (const table of Object.keys(this._tables)) {
      this._persist(table);
    }
  }

  _tableForSchema(schema) {
    if (!schema) return 'unknown';
    switch (schema.name) {
      case 'etat': return 'etat_clients';
      case 'bon': return 'bons';
      case 'devis': return 'devis';
      case 'ref':
        // Cas spécial géré dans insertRecord
        return 'ref_data';
      default: return schema.name;
    }
  }

  _toCamel(s) {
    return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  _persist(table) {
    const filePath = path.join(this.outputDir, `${table}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this._tables[table], null, 2));
  }
}

module.exports = { JsonAdapter };
