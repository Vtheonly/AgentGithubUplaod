import { generateReportPdf, type ReportSpec } from "../../../../infrastructure/receipt-pdf/report-document";
import { dzdPdf } from "../../../../infrastructure/receipt-pdf/shared";
import { buildXlsxBuffer, type SheetSpec } from "../../../../infrastructure/excel/export-engine";
import { AMOUNT_KIND_LABELS_FR, type ResolvedInspection, type LineageRecord } from "./data-inspector-lineage";

/** T-632: export adapters only — the resolved/filtered records and amounts
 * are consumed verbatim. Technical provenance is confined to its XLSX sheet. */
export function inspectorExportSheets(resolved: ResolvedInspection, records: readonly LineageRecord[], search: string): SheetSpec[] {
  return [{
    name: "Synthèse", columns: [{ header: "Rubrique", key: "label", width: 28 }, { header: "Valeur", key: "value", width: 70 }],
    rows: [
      { label: "Indicateur", value: resolved.request.title }, { label: "Définition", value: resolved.definition },
      { label: "Périmètre", value: resolved.scopeLabel }, { label: "Période", value: resolved.windowLabel ?? "Toutes les dates" },
      { label: "Recherche", value: search.trim() || "Tous les résultats" }, { label: "Lignes exportées", value: records.length },
      { label: "Formule", value: resolved.formula }, { label: "Valeur affichée", value: resolved.request.sourceValue },
      { label: "Valeur calculée", value: resolved.resolvedValue }, { label: "Écart", value: resolved.difference },
      ...resolved.formulaSteps.map((value, i) => ({ label: `Calcul ${i + 1}`, value })),
    ],
  }, {
    name: "Détail", columns: [
      ["Famille", "family"], ["Téléphone", "phone"], ["Élève", "student"], ["Classe", "class"],
      ["Prestation", "category"], ["Nature du montant", "kind"], ["Montant", "amount"], ["Part (%)", "share"],
      ["Date", "date"], ["Référence", "reference"], ["Statut", "status"], ["Méthode", "method"],
      ["Description", "description"], ["Détail", "detail"],
    ].map(([header, key]) => ({ header, key, width: 26 })),
    rows: records.map((row) => ({ family: row.contributorName, phone: row.contributorPhone, student: row.studentName,
      class: row.className, category: row.categoryLabel, kind: AMOUNT_KIND_LABELS_FR[row.amountKind], amount: row.amount,
      share: row.percentage, date: row.date, reference: humanReference(row.reference), status: row.status,
      method: row.method, description: clerkDetail(row.description), detail: clerkDetail(row.detail) })),
  }, {
    name: "Détails techniques", columns: [
      { header: "Ligne", key: "line" }, { header: "Code", key: "code" }, { header: "Table", key: "table" },
      { header: "Identifiant", key: "id" }, { header: "Référence brute", key: "reference" },
      { header: "Description brute", key: "description", width: 50 }, { header: "Détail brut", key: "detail", width: 50 },
    ], rows: records.map((row, i) => ({ line: i + 1, code: row.contributorCode, table: row.sourceTable, id: row.sourceId, reference: row.reference, description: row.description, detail: row.detail })),
  }];
}

function clerkDetail(value: string): string {
  // Keep the full source text in the support sheet. Import-run/UUID tokens
  // do not help a clerk understand a prestation or a tranche.
  return value
    .replace(/\bimport Excel run\s+run_[a-z0-9_-]+/gi, "Import Excel")
    .replace(/\brun_[a-z0-9_-]+/gi, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/[ \t]{2,}/g, " ").trim();
}

function humanReference(value: string): string {
  // Raw UUIDs are support details, not a clerk-facing receipt number.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? "" : value;
}

export async function inspectorXlsx(resolved: ResolvedInspection, records: readonly LineageRecord[], search: string): Promise<Uint8Array> {
  return buildXlsxBuffer(inspectorExportSheets(resolved, records, search));
}

export async function inspectorPdf(resolved: ResolvedInspection, records: readonly LineageRecord[], search: string): Promise<Uint8Array> {
  const spec: ReportSpec = {
    title: "Détail de l'indicateur", meta: [
      ["Indicateur", resolved.request.title], ["Périmètre", resolved.scopeLabel],
      ["Période", resolved.windowLabel ?? "Toutes les dates"], ["Lignes exportées", String(records.length)],
    ], sections: [{ heading: "Calcul", note: [resolved.definition, resolved.formula, ...resolved.formulaSteps,
      `Valeur affichée : ${dzdPdf(resolved.request.sourceValue)} ; valeur calculée : ${dzdPdf(resolved.resolvedValue)} ; écart : ${dzdPdf(resolved.difference)}`,
      `Recherche : ${search.trim() || "Tous les résultats"}`,
    ].join("\n") }, ...records.map((row, i) => ({
      heading: `${i + 1}. ${row.categoryLabel}`,
      note: [row.contributorName, row.studentName, row.className,
        `${AMOUNT_KIND_LABELS_FR[row.amountKind]} : ${dzdPdf(row.amount)} ; part : ${Math.round(row.percentage * 10) / 10} %`,
        row.date ? `Date : ${row.date.slice(0, 10)}` : "", row.method, row.status,
        humanReference(row.reference), clerkDetail(row.description), clerkDetail(row.detail),
      ].filter(Boolean).join("\n"),
    }))], footnote: "Les références techniques sont disponibles dans l'export Excel.",
  };
  return generateReportPdf(spec);
}
