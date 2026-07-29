'use strict';

const { defaultCoercer } = require('./FieldCoercer');

/**
 * Validateur de ligne : prend une ligne brute (mapping header -> value)
 * et un schéma, retourne une ligne validée + erreurs + avertissements.
 *
 * Gère aussi le cas spécial du type "monthlyArray" qui regroupe N colonnes
 * contiguës en un tableau indexé par mois.
 */
class RowValidator {
  constructor(schema) {
    this.schema = schema;
    this.coercer = defaultCoercer;
    this._buildFieldIndex();
  }

  _buildFieldIndex() {
    // Indexe les champs par header (normalisé) pour accès rapide
    this.fieldByHeader = {};
    for (const f of this.schema.fields) {
      const key = (f.header || '').toString().trim().toLowerCase();
      this.fieldByHeader[key] = f;
    }
  }

  /**
   * @param {Object} rawRow  — { headerName: value, ... }
   * @param {Number} rowIndex — index de la ligne (1-based) pour le reporting
   * @returns {{ record: Object, errors: Array, warnings: Array, skipped: Boolean }}
   */
  validate(rawRow, rowIndex) {
    const record = {};
    const errors = [];
    const warnings = [];

    // Coerce chaque champ défini dans le schéma
    for (const field of this.schema.fields) {
      // Cas spécial : monthlyArray — regroupe plusieurs colonnes
      if (field.type === 'monthlyArray') {
        const arr = this._coerceMonthlyArray(rawRow, field, errors, warnings);
        record[field.key] = arr;
        continue;
      }

      const rawValue = this._lookupValue(rawRow, field);
      const result = this.coercer.coerce(rawValue, field);
      record[field.key] = result.value;
      for (const e of result.errors) {
        errors.push({ ...e, field: field.key, row: rowIndex, header: field.header });
      }
      for (const w of result.warnings) {
        warnings.push({ ...w, field: field.key, row: rowIndex, header: field.header });
      }
    }

    // Si des erreurs bloquantes sont présentes, on marque la ligne comme "skipped"
    const skipped = errors.length > 0;

    return { record, errors, warnings, skipped };
  }

  _lookupValue(rawRow, field) {
    // 1) Match exact (header tel quel dans le rawRow)
    if (field.header && rawRow[field.header] !== undefined) {
      return rawRow[field.header];
    }
    // 2) Match normalisé (case + trim insensible)
    const targetKey = (field.header || '').toString().trim().toLowerCase();
    if (!targetKey) return undefined;
    for (const k of Object.keys(rawRow)) {
      if (k && k.toString().trim().toLowerCase() === targetKey) {
        return rawRow[k];
      }
    }
    return undefined;
  }

  _coerceMonthlyArray(rawRow, field, errors, warnings) {
    // Les colonnes mensuelles sont supposées contiguës après le header principal.
    // On les récupère via les clés de rawRow qui matchent le préfixe du header.
    const prefix = (field.header || '').toString().trim().toLowerCase();
    const arr = new Array(field.count || 12).fill(0);
    const labels = field.monthLabels || [];

    // Heuristique : prend les N prochaines colonnes après le header dans l'ordre d'apparition
    const rowKeys = Object.keys(rawRow);
    const headerIdx = rowKeys.findIndex(k => k && k.toString().trim().toLowerCase() === prefix);
    if (headerIdx === -1) return arr;

    const { parseNumber } = require('./rules/positiveNumber');

    for (let i = 0; i < (field.count || 12); i++) {
      const k = rowKeys[headerIdx + 1 + i];
      if (!k) break;
      let v = rawRow[k];
      // Si la valeur est un objet formule Excel non résolu, on tente d'extraire .result
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if (v.result !== undefined) v = v.result;
        else if (v.sharedFormula !== undefined || v.formula !== undefined) {
          // Formule partagée non calculée — on ignore silencieusement
          continue;
        } else {
          continue;
        }
      }
      if (v === null || v === undefined || v === '') continue;
      const parsed = parseNumber(v);
      if (parsed && parsed.error) {
        warnings.push({
          rule: 'monthlyArray',
          message: `Valeur mensuelle invalide « ${v} » (colonne ${k})`,
          field: field.key,
          row: -1,
          header: k
        });
      } else if (parsed !== null && typeof parsed === 'number') {
        arr[i] = parsed;
      }
    }

    return arr.reduce((acc, val, i) => {
      if (labels[i]) acc[labels[i]] = val;
      else acc[i] = val;
      return acc;
    }, {});
  }
}

module.exports = { RowValidator };
