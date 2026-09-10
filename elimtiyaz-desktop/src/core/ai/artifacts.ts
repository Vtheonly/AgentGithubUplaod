// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/artifacts.ts
// ============================================================================
/**
 * Tool-result ARTIFACTS — the rich-result architecture (T-272, 42nd
 * session — AI-311a).
 *
 * PROBLEM this closes: every tool result was a flat JSON blob the MODEL
 * read and re-typed as prose — the USER never saw a chart, a diagram, or
 * a downloadable document. The copilot "answered questions"; it did not
 * PRODUCE anything (the owner's "feels dumb / barely does anything"
 * finding, 2026-09-10).
 *
 * ARCHITECTURE (ADR-016):
 *   1. A tool result remains a JSON string on the wire (the model reads
 *      it as the `role: "tool"` message content — unchanged protocol).
 *   2. That JSON may carry ONE structured `artifact` payload under the
 *      reserved `"artifact"` key.
 *   3. The copilot drawer parses each tool message; when an artifact is
 *      present it renders a real visual card (SVG chart, diagram) or a
 *      document card (PDF/XLSX/CSV download) BELOW the tool indicator.
 *   4. Artifacts are self-describing and data-capped: charts carry their
 *      series inline (small aggregates); documents carry their REFETCH
 *      params (PDF bytes never travel through the conversation) or their
 *      row payload (XLSX/CSV exports, capped at MAX_EXPORT_ROWS).
 *
 * Validation philosophy (the REG-005 lesson — never trust the producer):
 * every artifact entering the RENDER path is validated here first. A
 * malformed artifact is DROPPED (logged), never rendered — the model's
 * textual answer still stands on its own.
 */

/* ------------------------------------------------------------------ */
/*  Chart artifacts                                                    */
/* ------------------------------------------------------------------ */

export type ChartType =
  | "bar"
  | "grouped_bar"
  | "stacked_bar"
  | "line"
  | "area"
  | "pie"
  | "donut";

export type ChartUnit = "DZD" | "percent" | "count" | "rate" | "score";

/** One series of a chart. `data.length` MUST equal `categories.length`. */
export interface ChartSeries {
  readonly name: string;
  readonly data: readonly number[];
  /** Optional hex color; the renderer palette assigns one when absent. */
  readonly color?: string;
}

export interface ChartArtifact {
  readonly kind: "chart";
  readonly chartType: ChartType;
  readonly title: string;
  readonly categories: readonly string[];
  readonly series: readonly ChartSeries[];
  readonly unit?: ChartUnit;
  readonly caption?: string;
}

/* ------------------------------------------------------------------ */
/*  Diagram artifacts                                                  */
/* ------------------------------------------------------------------ */

export type DiagramType = "hierarchy" | "flow";

export type DiagramNodeKind = "root" | "branch" | "leaf" | "step";

export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string;
  /** Depth tier (0 = top) — drives the layered layout. */
  readonly level: number;
  readonly kind?: DiagramNodeKind;
}

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface DiagramArtifact {
  readonly kind: "diagram";
  readonly diagramType: DiagramType;
  readonly title: string;
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly caption?: string;
}

/* ------------------------------------------------------------------ */
/*  Document artifacts                                                 */
/* ------------------------------------------------------------------ */

export type DocumentFormat = "pdf" | "xlsx" | "csv";

export type DocumentType =
  | "parent_statement"
  | "class_report"
  | "debt_report"
  | "payment_plan"
  | "data_export";

/**
 * A downloadable document. Two carrying modes:
 *   - PDF (`format: "pdf"`): `params` carries the identifiers the
 *     provider needs to REFETCH canonical data and build the PDF via the
 *     receipt-pdf generators (bytes never enter the conversation).
 *   - XLSX / CSV: `columns` + `rows` are embedded (capped) so the export
 *     is self-contained and what-you-see-is-what-you-download.
 */
export interface DocumentArtifact {
  readonly kind: "document";
  readonly format: DocumentFormat;
  readonly documentType: DocumentType;
  readonly title: string;
  readonly fileName: string;
  /** Refetch parameters (PDF mode) or dataset params (export mode). */
  readonly params: Record<string, string | number | boolean | null>;
  readonly columns?: readonly string[];
  readonly rows?: readonly (readonly (string | number | null)[])[];
  readonly rowCount?: number;
  /** True when the embedded rows were capped (the export notes it). */
  readonly truncated?: boolean;
  readonly caption?: string;
}

export type ToolArtifact = ChartArtifact | DiagramArtifact | DocumentArtifact;

/** Hard cap on embedded export rows — conversation payloads stay sane. */
export const MAX_EXPORT_ROWS = 500;
/** Hard caps on chart dimensions — the model composes, not floods. */
export const MAX_CATEGORIES = 60;
export const MAX_SERIES = 6;

/* ------------------------------------------------------------------ */
/*  Validation (the render-path gate — ADR-016 §3)                     */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const CHART_TYPES: readonly ChartType[] = [
  "bar",
  "grouped_bar",
  "stacked_bar",
  "line",
  "area",
  "pie",
  "donut",
];
const CHART_UNITS: readonly ChartUnit[] = ["DZD", "percent", "count", "rate", "score"];
const DIAGRAM_TYPES: readonly DiagramType[] = ["hierarchy", "flow"];
const NODE_KINDS: readonly DiagramNodeKind[] = ["root", "branch", "leaf", "step"];
const DOC_FORMATS: readonly DocumentFormat[] = ["pdf", "xlsx", "csv"];
const DOC_TYPES: readonly DocumentType[] = [
  "parent_statement",
  "class_report",
  "debt_report",
  "payment_plan",
  "data_export",
];

/** Validate a chart artifact; returns null when malformed. */
export function validateChartArtifact(v: unknown): ChartArtifact | null {
  if (!isRecord(v) || v.kind !== "chart") return null;
  if (typeof v.title !== "string" || v.title.trim().length === 0) return null;
  if (typeof v.chartType !== "string" || !CHART_TYPES.includes(v.chartType as ChartType)) {
    return null;
  }
  if (!Array.isArray(v.categories) || v.categories.length === 0) return null;
  if (v.categories.length > MAX_CATEGORIES) return null;
  if (v.categories.some((c) => typeof c !== "string")) return null;
  if (!Array.isArray(v.series) || v.series.length === 0) return null;
  if (v.series.length > MAX_SERIES) return null;

  const n = v.categories.length;
  const series: ChartSeries[] = [];
  for (const s of v.series) {
    if (!isRecord(s) || typeof s.name !== "string" || !Array.isArray(s.data)) return null;
    if (s.data.length !== n) return null;
    if (s.data.some((d) => !isFiniteNumber(d))) return null;
    if (s.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(s.color))) return null;
    series.push({ name: s.name, data: [...s.data], color: s.color as string | undefined });
  }

  // Pie/donut/stacked semantics: exactly one series (pie/donut), all
  // values non-negative (pie/donut can't render negatives).
  if ((v.chartType === "pie" || v.chartType === "donut") && series.length !== 1) return null;
  if ((v.chartType === "pie" || v.chartType === "donut") && series[0].data.some((d) => d < 0)) {
    return null;
  }
  if (v.chartType === "stacked_bar" && series.some((s) => s.data.some((d) => d < 0))) return null;

  const unit = v.unit === undefined ? undefined : (v.unit as ChartUnit);
  if (unit !== undefined && !CHART_UNITS.includes(unit)) return null;

  return {
    kind: "chart",
    chartType: v.chartType as ChartType,
    title: v.title,
    categories: [...(v.categories as string[])],
    series,
    unit,
    caption: typeof v.caption === "string" ? v.caption : undefined,
  };
}

/** Validate a diagram artifact; returns null when malformed. */
export function validateDiagramArtifact(v: unknown): DiagramArtifact | null {
  if (!isRecord(v) || v.kind !== "diagram") return null;
  if (typeof v.title !== "string" || v.title.trim().length === 0) return null;
  if (typeof v.diagramType !== "string" || !DIAGRAM_TYPES.includes(v.diagramType as DiagramType)) {
    return null;
  }
  if (!Array.isArray(v.nodes) || v.nodes.length === 0 || v.nodes.length > 40) return null;

  const nodes: DiagramNode[] = [];
  for (const n of v.nodes) {
    if (!isRecord(n) || typeof n.id !== "string" || typeof n.label !== "string") return null;
    if (!Number.isInteger(n.level) || (n.level as number) < 0 || (n.level as number) > 6) return null;
    if (n.kind !== undefined && !NODE_KINDS.includes(n.kind as DiagramNodeKind)) return null;
    nodes.push({
      id: n.id,
      label: n.label,
      sublabel: typeof n.sublabel === "string" ? n.sublabel : undefined,
      level: n.level as number,
      kind: n.kind as DiagramNodeKind | undefined,
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return null; // duplicate ids

  if (!Array.isArray(v.edges) || v.edges.length > 80) return null;
  const edges: DiagramEdge[] = [];
  for (const e of v.edges) {
    if (!isRecord(e) || typeof e.from !== "string" || typeof e.to !== "string") return null;
    if (!ids.has(e.from) || !ids.has(e.to)) return null; // dangling edge
    edges.push({
      from: e.from,
      to: e.to,
      label: typeof e.label === "string" ? e.label : undefined,
    });
  }

  return {
    kind: "diagram",
    diagramType: v.diagramType as DiagramType,
    title: v.title,
    nodes,
    edges,
    caption: typeof v.caption === "string" ? v.caption : undefined,
  };
}

/**
 * Validate a document artifact; returns null when malformed.
 * PDF documents MUST carry a non-empty `documentType` + `fileName` + a
 * params record; XLSX/CSV MUST carry aligned `columns`/`rows`.
 */
export function validateDocumentArtifact(v: unknown): DocumentArtifact | null {
  if (!isRecord(v) || v.kind !== "document") return null;
  if (typeof v.title !== "string" || v.title.trim().length === 0) return null;
  if (typeof v.fileName !== "string" || !/^[\w.\- ]+$/.test(v.fileName) || v.fileName.length > 120) {
    return null;
  }
  if (!DOC_FORMATS.includes(v.format as DocumentFormat)) return null;
  if (!DOC_TYPES.includes(v.documentType as DocumentType)) return null;
  if (!isRecord(v.params)) return null;
  for (const val of Object.values(v.params)) {
    if (!["string", "number", "boolean"].includes(typeof val) && val !== null) return null;
  }

  let columns: string[] | undefined;
  let rows: (string | number | null)[][] | undefined;
  if (v.format === "xlsx" || v.format === "csv" || Array.isArray(v.rows)) {
    if (!Array.isArray(v.columns) || v.columns.length === 0 || v.columns.length > 30) return null;
    if (v.columns.some((c) => typeof c !== "string")) return null;
    if (!Array.isArray(v.rows) || v.rows.length === 0) return null;
    if (v.rows.length > MAX_EXPORT_ROWS) return null;
    for (const r of v.rows) {
      if (!Array.isArray(r) || r.length !== v.columns.length) return null;
      if (r.some((cell) => !["string", "number"].includes(typeof cell) && cell !== null)) {
        return null;
      }
    }
    columns = [...(v.columns as string[])];
    rows = (v.rows as (string | number | null)[][]).map((r) => [...r]);
  }

  return {
    kind: "document",
    format: v.format as DocumentFormat,
    documentType: v.documentType as DocumentType,
    title: v.title,
    fileName: v.fileName,
    params: v.params as Record<string, string | number | boolean | null>,
    columns,
    rows,
    rowCount: isFiniteNumber(v.rowCount) ? v.rowCount : rows?.length,
    truncated: v.truncated === true,
    caption: typeof v.caption === "string" ? v.caption : undefined,
  };
}

/** Validate any artifact (chart | diagram | document); null when malformed. */
export function validateToolArtifact(v: unknown): ToolArtifact | null {
  if (!isRecord(v)) return null;
  switch (v.kind) {
    case "chart":
      return validateChartArtifact(v);
    case "diagram":
      return validateDiagramArtifact(v);
    case "document":
      return validateDocumentArtifact(v);
    default:
      return null;
  }
}

/**
 * Parse a tool-output JSON string and extract its validated artifact.
 * Returns null for: non-JSON payloads, no `artifact` key, or a malformed
 * artifact. Never throws — the render path is fail-open to "no visual".
 */
export function parseToolArtifact(toolOutput: string): ToolArtifact | null {
  try {
    const parsed = JSON.parse(toolOutput) as { artifact?: unknown };
    if (parsed === null || typeof parsed !== "object" || !("artifact" in parsed)) return null;
    return validateToolArtifact(parsed.artifact);
  } catch {
    return null;
  }
}

/**
 * Build a tool-result envelope that carries data + one artifact.
 * Used by the tool layer so every producer emits the SAME shape.
 */
export function withArtifact(data: Record<string, unknown>, artifact: ToolArtifact): string {
  return JSON.stringify({ ...data, artifact });
}
