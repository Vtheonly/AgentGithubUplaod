'use strict';

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { UnsupportedFormatError, FileNotFoundError } = require('../errors');
const { SheetDetector } = require('./SheetDetector');

/**
 * Parseur Excel basé sur exceljs.
 *
 * Responsabilités :
 *   - Ouvrir le fichier (.xlsx, .xlsm) via exceljs (avec valeurs calculées).
 *   - Lister les feuilles disponibles.
 *   - Pour chaque feuille : détecter le schéma, lire l'en-tête, itérer
 *     sur les lignes de données en émettant des objets { header: value }.
 *   - Supporter la lecture streaming pour les grosses feuilles (>5000 lignes).
 *
 * Ne fait AUCUNE validation métier — délègue au RowValidator.
 */
class ExcelParser {
  constructor(options = {}) {
    this.options = options;
    this.detector = new SheetDetector();
  }

  /**
   * Ouvre un workbook Excel.
   * @param {String|Buffer} input — chemin ou buffer
   * @returns {Promise<ExcelJS.Workbook>}
   */
  async open(input) {
    if (typeof input === 'string') {
      if (!fs.existsSync(input)) throw new FileNotFoundError(input);
      const ext = path.extname(input).toLowerCase();
      if (!['.xlsx', '.xlsm'].includes(ext)) {
        throw new UnsupportedFormatError(input, `extension non supportée « ${ext} » (attendu .xlsx ou .xlsm)`);
      }
    }

    const wb = new ExcelJS.Workbook();
    // options : ignoreNodes pour éviter de parser les dessins/charts,
    // sharedStrings en mode lazy pour gros fichiers
    if (typeof input === 'string') {
      await wb.xlsx.readFile(input, {
        sharedStrings: 'cache',
        worksheets: 'emit',
        ...this.options.readOptions
      });
    } else {
      await wb.xlsx.load(input, this.options.readOptions);
    }
    return wb;
  }

  /**
   * Liste les feuilles du workbook avec leur schéma détecté.
   * @returns {Promise<Array<{ name: String, schema: Object|null, rowCount: Number }>>}
   */
  async listSheets(input) {
    const wb = await this.open(input);
    return wb.worksheets.map(ws => {
      // Lit la première ligne pour aider la détection (sauf si headerRow=0)
      const headerRow = this._readHeaderRow(ws, 0);
      const schema = this.detector.detect(ws.name, headerRow);
      return {
        name: ws.name,
        rowCount: ws.rowCount,
        schema
      };
    });
  }

  /**
   * Itère sur les lignes d'une feuille.
   *
   * @param {ExcelJS.Worksheet} ws
   * @param {Object} schema — schéma applicable (peut être null pour une feuille inconnue)
   * @param {Object} opts — { onRow(row, idx), onProgress(read, total) }
   * @returns {Promise<Object>} — { rowsRead, headers }
   */
  async iterateRows(ws, schema, opts = {}) {
    const { onRow, onProgress } = opts;
    // Note : on utilise ?? (nullish coalescing) car headerRow=0 est une valeur valide
    // signifiant "pas d'en-tête". L'opérateur || aurait transformé 0 en 1 (bug).
    const headerRowNumber = (schema && schema.headerRow != null) ? schema.headerRow : 1;
    const dataStartRow = (schema && schema.dataStartRow != null)
      ? schema.dataStartRow
      : (headerRowNumber === 0 ? 1 : headerRowNumber + 1);

    let headers;
    if (headerRowNumber === 0) {
      // Pas d'en-tête : on génère des en-têtes synthétiques A, B, C, ...
      // à partir du nombre de colonnes de la feuille.
      const colCount = ws.columnCount || 1;
      headers = [];
      for (let c = 1; c <= colCount; c++) {
        headers.push(this._colLetter(c));
      }
    } else {
      headers = this._readHeaderRow(ws, headerRowNumber);
    }
    const headerToKey = this._buildHeaderMap(headers);

    const total = ws.rowCount || 0;
    let read = 0;

    for (let r = dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row || row.cellCount === 0) continue;

      // Vérifie si la ligne est complètement vide
      let isEmpty = true;
      const obj = {};
      for (let c = 1; c <= headers.length; c++) {
        const headerName = headers[c - 1];
        // Skip les colonnes sans header (ex: colonne A vide dans ETAT)
        if (!headerName) continue;
        const cell = row.getCell(c);
        const v = cell && cell.value !== undefined ? cell.value : null;
        if (v !== null && v !== '' && v !== undefined) isEmpty = false;
        obj[headerName] = this._normalizeCell(cell);
      }

      if (isEmpty) {
        read++;
        continue;
      }

      // Ajoute l'index de ligne pour le reporting
      obj.__rowIndex = r;

      if (onRow) {
        // Le callback peut être async (upsert awaité) — on attend sa résolution
        // pour garantir que les compteurs sont à jour avant le retour de iterateRows.
        await onRow(obj, r);
      }
      read++;
      if (onProgress && read % 50 === 0) onProgress(read, total);
    }

    if (onProgress) onProgress(read, total);

    return { rowsRead: read, headers };
  }

  _readHeaderRow(ws, headerRowNumber) {
    // Si headerRowNumber = 0, cela signifie "pas d'en-tête".
    // On retourne un tableau de lettres de colonnes pour le listSheets
    // (mais iterateRows gère ce cas séparément en générant des en-têtes synthétiques).
    if (headerRowNumber === 0) {
      const colCount = ws.columnCount || 1;
      const headers = [];
      for (let c = 1; c <= colCount; c++) {
        headers.push(this._colLetter(c));
      }
      return headers;
    }
    // exceljs est 1-based ; headerRowNumber dans nos schémas est déjà 1-based.
    const row = ws.getRow(headerRowNumber);
    if (!row) return [];
    const headers = [];
    const colCount = ws.columnCount || row.cellCount || 0;
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      let v = this._normalizeCell(cell);
      // Normalise : trim pour faciliter le matching.
      if (typeof v === 'string') v = v.trim();
      headers.push(v);
    }
    return headers;
  }

  _buildHeaderMap(headers) {
    const map = {};
    headers.forEach((h, i) => {
      if (h) map[h.toString().trim().toLowerCase()] = i + 1;
    });
    return map;
  }

  /**
   * Normalise la valeur d'une cellule ExcelJS en valeur JS simple.
   * Gère les formules (résultat .result), les dates, les hyperlinks,
   * et les erreurs (#REF! etc.).
   */
  _normalizeCell(cell) {
    if (!cell) return null;
    let v = cell.value;

    // Gestion des objets ExcelJS (formules, hyperlinks, shared strings)
    if (v && typeof v === 'object') {
      if (v.result !== undefined) {
        // Formule : on prend le résultat calculé
        v = v.result;
      } else if (v.sharedFormula !== undefined || v.formula !== undefined) {
        // Formule partagée sans résultat calculé (Excel n'a pas recalculé).
        // On retourne null silencieusement — la valeur n'est pas exploitable.
        v = null;
      } else if (v.text !== undefined) {
        v = v.text;
      } else if (v.richText && Array.isArray(v.richText)) {
        v = v.richText.map(t => t.text).join('');
      } else if (v.error) {
        v = v.error; // ex: "#REF!"
      } else if (v instanceof Date) {
        v = v;
      } else {
        // Objet inattendu — sérialise en JSON pour inspection
        try { v = JSON.stringify(v); } catch { v = String(v); }
      }
    }

    return v;
  }

  /**
   * Convertit un index de colonne 1-based en lettre Excel (1→A, 27→AA, etc.).
   */
  _colLetter(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
}

module.exports = { ExcelParser, defaultParser: new ExcelParser() };
