'use strict';

/**
 * Matcheur d'upsert — détermine les clés d'identité d'un schéma
 * et fournit une fonction de hash pour recherche rapide.
 *
 * Pour la feuille ETAT, les clés sont NEM + NOM.
 * Si NEM est un tableau (phoneList), on prend la jointure par ",".
 *
 * Note : le schéma définit `identity.fields` avec les noms de HEADER
 * (ex: 'NEM', 'NOM'), mais le record coercé utilise les `field.key`
 * camelCase (ex: 'nem', 'nom'). On construit donc un mapping
 * header → key pour faire la traduction.
 */
class UpsertMatcher {
  constructor(schema) {
    this.schema = schema;
    this.identityFields = (schema.identity && schema.identity.fields) || [];
    // Map header (uppercase) → field.key (camelCase)
    this.headerToKey = {};
    for (const f of schema.fields || []) {
      if (f.header) {
        this.headerToKey[f.header.toString().trim().toLowerCase()] = f.key;
      }
    }
  }

  /**
   * Extrait les valeurs d'identité d'un record coercé.
   * @returns {Object|null} — { fieldKey: value } ou null si champs requis manquants
   */
  extractIdentity(record) {
    if (this.identityFields.length === 0) return null;
    const identity = {};
    for (const headerName of this.identityFields) {
      const key = this.headerToKey[headerName.toString().trim().toLowerCase()] || headerName;
      let v = record[key];
      // Tableaux (ex: phoneList) → join en chaîne
      if (Array.isArray(v)) v = v.join(',');
      // Dates → ISO string
      if (v instanceof Date) v = v.toISOString();
      if (v === null || v === undefined || v === '') return null;
      identity[key] = v;
    }
    return identity;
  }

  /**
   * Vérifie si deux records sont identiques selon les clés d'identité.
   */
  sameIdentity(a, b) {
    for (const headerName of this.identityFields) {
      const key = this.headerToKey[headerName.toString().trim().toLowerCase()] || headerName;
      let va = a[key], vb = b[key];
      if (Array.isArray(va)) va = va.join(',');
      if (Array.isArray(vb)) vb = vb.join(',');
      if (va !== vb) return false;
    }
    return true;
  }

  /**
   * Stratégie d'upsert du schéma : 'upsert' | 'insert' | 'skip'
   */
  strategy() {
    return (this.schema.identity && this.schema.identity.strategy) || 'insert';
  }
}

module.exports = { UpsertMatcher };
