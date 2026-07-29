'use strict';

/**
 * Interface abstraite pour les adaptateurs de stockage.
 *
 * Toutes les méthodes retournent des Promises (sauf indication contraire
 * pour les adapters synchrones comme SQLite).
 *
 * Un adaptateur doit implémenter :
 *   - async init()                — créer tables, index, connexions
 *   - async beginTransaction()    — démarrer une transaction
 *   - async commitTransaction()
 *   - async rollbackTransaction()
 *   - async upsertRecord(schema, record, identityKeys) -> { action: 'insert'|'update'|'skip', id }
 *   - async insertRecord(table, record) -> id
 *   - async findRecord(schema, identityKeys, values) -> record | null
 *   - async saveAuditRun(context)
 *   - async close()
 */
class StorageAdapter {
  async init() { throw new Error('not implemented'); }
  async beginTransaction() { throw new Error('not implemented'); }
  async commitTransaction() { throw new Error('not implemented'); }
  async rollbackTransaction() { throw new Error('not implemented'); }
  async upsertRecord(/* schema, record, identityKeys */) { throw new Error('not implemented'); }
  async insertRecord(/* table, record */) { throw new Error('not implemented'); }
  async findRecord(/* schema, identityKeys, values */) { throw new Error('not implemented'); }
  async saveAuditRun(/* context */) { throw new Error('not implemented'); }
  async close() { throw new Error('not implemented'); }
}

module.exports = { StorageAdapter };
