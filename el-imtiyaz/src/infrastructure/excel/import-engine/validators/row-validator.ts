import type { ImportSchema, FieldSpec, ImportRecord } from "../types";
import { defaultCoercer } from "./field-coercer";
import { parseNumber, type ParsedNumber } from "./rules/positive-number";
import type { RuleIssue } from "./rules/types";

export interface RowValidationResult {
  record: ImportRecord;
  errors: RuleIssue[];
  warnings: RuleIssue[];
  skipped: boolean;
  isNonDataRow?: boolean;
}

const SUMMARY_KEYWORDS = [
  "TOTAL",
  "TOTAUX",
  "SOMME",
  "MOYENNE",
  "NB",
  "NOMBRE",
  "RECAP",
  "RECAPITULATIF",
  "STATISTIQUE",
  "COUNT",
  "SUM",
  "AVERAGE",
];

const HEADER_ALIASES: Record<string, string[]> = {
  nom: [
    "nom",
    "nom & prenom",
    "nom et prenom",
    "nom prenom",
    "eleve",
    "eleves",
    "éleve",
    "élèves",
    "nom eleve",
    "nom élève",
    "prenom eleve",
    "prénom élève",
  ],
  eleve: [
    "eleves",
    "eleve",
    "éleve",
    "élèves",
    "nom eleve",
    "nom élève",
    "prenom eleve",
    "prénom élève",
    "nom",
  ],
  prenomEleve: [
    "prenom eleve",
    "prénom élève",
    "prenom",
    "prénom",
    "eleve",
    "éleve",
  ],
  client: ["client", "clients", "nom client", "tuteur", "parent", "nom parent"],
  devisNumero: [
    "devis n°",
    "n° devis",
    "no devis",
    "devis no",
    "devis",
    "num devis",
  ],
  devisAnnuel: ["devis annuel", "devis", "montant devis", "devis annue"],
  classe: ["classe", "classes", "class"],
  niveau: ["niveau", "niveaus", "cycle", "palier"],
  nem: [
    "nem",
    "telephone",
    "téléphone",
    "tel",
    "tél",
    "phone",
    "contact",
    "mobile",
  ],
  email: ["e-mail", "email", "mail", "courriel"],
  tuteur: ["tuteur", "parent", "nom parent", "client"],
};

export class RowValidator {
  private readonly schema: ImportSchema;

  constructor(schema: ImportSchema) {
    this.schema = schema;
  }

  private normalizeString(s: string): string {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /**
   * Check if a raw row is a summary row, total row, or non-data row.
   */
  isSummaryOrNonDataRow(rawRow: Record<string, unknown>): boolean {
    if (!rawRow || typeof rawRow !== "object") return true;

    // 1. Check primary text fields for summary keywords
    for (const [key, val] of Object.entries(rawRow)) {
      if (key.startsWith("__")) continue;
      if (typeof val === "string") {
        const normVal = this.normalizeString(val).toUpperCase();
        for (const kw of SUMMARY_KEYWORDS) {
          if (
            normVal === kw ||
            normVal.startsWith(kw + " ") ||
            normVal.startsWith(kw + ":") ||
            normVal.startsWith(kw + " -") ||
            normVal.startsWith(kw + "_")
          ) {
            return true;
          }
        }
      }
    }

    // 2. Check if key identifying fields for the schema are completely missing
    if (this.schema.name === "etat") {
      const nomVal = this.lookupValue(rawRow, {
        key: "nom",
        header: "NOM",
        type: "string",
        required: true,
      });
      if (!nomVal || typeof nomVal !== "string" || nomVal.trim() === "") {
        return true; // No student name -> not a student row
      }
    } else if (this.schema.name === "bon") {
      const eleveVal = this.lookupValue(rawRow, {
        key: "eleve",
        header: "ELEVES",
        type: "string",
        required: false,
      });
      const clientVal = this.lookupValue(rawRow, {
        key: "client",
        header: "CLIENT",
        type: "string",
        required: false,
      });
      if (
        (!eleveVal || String(eleveVal).trim() === "") &&
        (!clientVal || String(clientVal).trim() === "")
      ) {
        return true; // Neither student nor client name -> not a receipt row
      }
    } else if (this.schema.name === "devis") {
      const prenomVal = this.lookupValue(rawRow, {
        key: "prenomEleve",
        header: "Prenom élève",
        type: "string",
        required: false,
      });
      const clientVal = this.lookupValue(rawRow, {
        key: "client",
        header: "Client",
        type: "string",
        required: false,
      });
      const devisNumVal = this.lookupValue(rawRow, {
        key: "devisNumero",
        header: "Devis n°",
        type: "string",
        required: false,
      });
      if (
        (!prenomVal || String(prenomVal).trim() === "") &&
        (!clientVal || String(clientVal).trim() === "") &&
        (!devisNumVal || String(devisNumVal).trim() === "")
      ) {
        return true; // No quote info -> not a quote row
      }
    }

    return false;
  }

  validate(
    rawRow: Record<string, unknown>,
    rowIndex: number,
  ): RowValidationResult {
    const record: ImportRecord = {};
    const errors: RuleIssue[] = [];
    const warnings: RuleIssue[] = [];

    // Check if summary or non-data row
    if (this.isSummaryOrNonDataRow(rawRow)) {
      return {
        record: {},
        errors: [],
        warnings: [],
        skipped: true,
        isNonDataRow: true,
      };
    }

    for (const field of this.schema.fields) {
      if (field.type === "monthlyArray") {
        const arr = this.coerceMonthlyArray(rawRow, field, warnings, rowIndex);
        record[field.key] = arr;
        continue;
      }

      const rawValue = this.lookupValue(rawRow, field);
      const result = defaultCoercer.coerce(rawValue, field);
      record[field.key] = result.value;
      for (const e of result.errors) {
        errors.push({
          ...e,
          field: field.key,
          header: field.header,
          rawValue:
            e.rawValue ??
            (rawValue !== undefined ? String(rawValue) : undefined),
        });
      }
      for (const w of result.warnings) {
        warnings.push({ ...w, field: field.key, header: field.header });
      }
    }

    // Iteration 21: "Import student no matter what" — never skip a data row.
    // Convert all errors to warnings so they appear in the import report
    // (for data quality awareness) but the row still gets upserted.
    // The only rows that get skipped are non-data rows (summary/empty),
    // handled by the isSummaryOrNonDataRow check above.
    return { record, errors: [], warnings: [...warnings, ...errors], skipped: false };
  }

  private lookupValue(
    rawRow: Record<string, unknown>,
    field: FieldSpec,
  ): unknown {
    // 1) Direct exact match
    if (field.header && rawRow[field.header] !== undefined) {
      return rawRow[field.header];
    }
    if (rawRow[field.key] !== undefined) {
      return rawRow[field.key];
    }

    // 2) Normalized match (case, whitespace, accents)
    const targetHeaderNorm = field.header
      ? this.normalizeString(field.header)
      : "";
    const targetKeyNorm = this.normalizeString(field.key);

    for (const [k, v] of Object.entries(rawRow)) {
      if (k.startsWith("__")) continue;
      const kNorm = this.normalizeString(k);
      if (
        (targetHeaderNorm && kNorm === targetHeaderNorm) ||
        kNorm === targetKeyNorm
      ) {
        return v;
      }
    }

    // 3) Aliases match
    const aliases = HEADER_ALIASES[field.key] ?? [];
    for (const [k, v] of Object.entries(rawRow)) {
      if (k.startsWith("__")) continue;
      const kNorm = this.normalizeString(k);
      for (const alias of aliases) {
        if (kNorm === this.normalizeString(alias)) {
          return v;
        }
      }
    }

    return undefined;
  }

  private coerceMonthlyArray(
    rawRow: Record<string, unknown>,
    field: FieldSpec,
    warnings: RuleIssue[],
    _rowIndex: number,
  ): Record<string, number> {
    const count = field.count ?? 12;
    const labels = field.monthLabels ?? [];
    const arr: number[] = new Array(count).fill(0);
    const prefix = (field.header || "").toString().trim().toLowerCase();

    const rowKeys = Object.keys(rawRow);
    const headerIdx = rowKeys.findIndex(
      (k) => k.toString().trim().toLowerCase() === prefix,
    );
    if (headerIdx === -1) {
      return arr.reduce(
        (acc, val, i) => {
          if (labels[i]) acc[labels[i]] = val;
          else acc[String(i)] = val;
          return acc;
        },
        {} as Record<string, number>,
      );
    }

    for (let i = 0; i < count; i++) {
      const k = rowKeys[headerIdx + 1 + i];
      if (!k) break;
      let v: unknown = rawRow[k];
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const obj = v as {
          result?: unknown;
          sharedFormula?: unknown;
          formula?: unknown;
        };
        if (obj.result !== undefined) v = obj.result;
        else if (obj.sharedFormula !== undefined || obj.formula !== undefined)
          continue;
        else continue;
      }
      if (v === null || v === undefined || v === "") continue;

      const parsed: ParsedNumber = parseNumber(v);
      if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
        warnings.push({
          field: field.key,
          header: k,
          rule: "monthlyArray",
          message: `Valeur mensuelle invalide « ${v} » (colonne ${k})`,
          rawValue: String(v),
        });
      } else if (parsed !== null && typeof parsed === "number") {
        arr[i] = parsed;
      }
    }

    return arr.reduce(
      (acc, val, i) => {
        if (labels[i]) acc[labels[i]] = val;
        else acc[String(i)] = val;
        return acc;
      },
      {} as Record<string, number>,
    );
  }
}
