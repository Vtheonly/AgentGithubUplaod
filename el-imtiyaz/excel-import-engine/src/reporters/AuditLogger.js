'use strict';

/**
 * AuditLogger — délègue à l'adaptateur de stockage pour persister
 * le contexte d'import dans la table import_runs + import_errors.
 *
 * C'est une couche fine qui isole la logique de reporting du stockage.
 */
class AuditLogger {
  constructor(storageAdapter) {
    this.storage = storageAdapter;
  }

  async saveRun(context) {
    if (typeof this.storage.saveAuditRun !== 'function') {
      // L'adaptateur ne supporte pas l'audit (ex: JSON basique) — on skippe
      return { status: 'skipped', errorsCount: 0 };
    }
    return this.storage.saveAuditRun(context);
  }
}

module.exports = { AuditLogger };
