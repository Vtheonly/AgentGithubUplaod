/**
 * ImportConfigRegistry — the CENTRALIZED repository of import
 * configurations (T-414 / IMPORT-111 / ADR-026, 2026-09-26).
 *
 * The single access point for every import configuration in the system:
 * registering, loading, identifying, selecting, validating, versioning,
 * resolving and managing them. Spreadsheet-specific knowledge lives in the
 * registered `ImportConfigDocument`s (data); the ENGINE stays generic and
 * consumes the compiled `ImportSchema`s this registry resolves.
 *
 * Responsibilities (the mandate's list, verbatim):
 *   - register  : `register(doc)` — validates then stores.
 *   - load      : `get(id)` / `list()` / `listSummaries()`.
 *   - identify  : `identify(sheetName)` — which configs could own a sheet.
 *   - select    : `detect(sheetName, headerRow)` — format disambiguation by
 *                 header signature (specificity) + explicit `selectConfig`.
 *   - validate  : `validate(doc)` — structural validation (ids, fields,
 *                 addressing, identity, duplication hazards).
 *   - version   : documents carry a `version`; `get(id, version)` can pin
 *                 an explicit version (latest by default).
 *   - resolve   : `resolve(id)` / `resolveAll()` — compile documents to the
 *                 engine's runtime `ImportSchema`s.
 *   - manage    : `setEnabled(id, enabled)` — enable/disable without
 *                 unregistering.
 *
 * Detection contract (the sheet-name collision problem): "ETAT 20262027"
 * exists in BOTH supported workbooks. Tier 1 (name regex) shortlists the
 * candidates; when several match, the ACTUAL header row disambiguates —
 * the config whose `requiredHeaders` are ALL present wins, the most
 * specific signature first, then `detectionPriority`, then the newest
 * version.
 */
import type { ImportSchema, FieldSpec } from "../import-engine/types";
import type {
  ImportConfigDocument,
  ImportConfigIssue,
  ImportConfigSummary,
  ImportSheetConfig,
} from "./types";
import type { ImportConfigStore } from "./extensions";

/** Normalize a header string the way the engine does (case/space/accents). */
const norm = (s: string): string =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const COLUMN_RE = /^[A-Za-z]{1,2}$/;

/** Compile one sheet config into the engine's runtime schema. */
export function compileSheetConfig(sheet: ImportSheetConfig): ImportSchema {
  const fields: FieldSpec[] = sheet.fields.map((f) => ({
    key: f.key,
    header: f.header ?? "",
    type: f.type,
    required: f.required ?? false,
    ...(f.values !== undefined ? { values: f.values } : {}),
    ...(f.tolerateUnknown !== undefined ? { tolerateUnknown: f.tolerateUnknown } : {}),
    ...(f.minLength !== undefined ? { minLength: f.minLength } : {}),
    ...(f.min !== undefined ? { min: f.min } : {}),
    ...(f.max !== undefined ? { max: f.max } : {}),
    ...(f.default !== undefined ? { default: f.default } : {}),
    ...(f.count !== undefined ? { count: f.count } : {}),
    ...(f.monthLabels !== undefined ? { monthLabels: f.monthLabels } : {}),
    ...(f.uppercase !== undefined ? { uppercase: f.uppercase } : {}),
    ...(f.lowercase !== undefined ? { lowercase: f.lowercase } : {}),
    ...(f.column !== undefined ? { column: f.column } : {}),
    ...(f.headerAliases !== undefined ? { aliases: f.headerAliases } : {}),
  }));
  return {
    name: sheet.name,
    sheetMatchers: sheet.sheetMatchers.map((src) => new RegExp(src, "i")),
    headerRow: sheet.headerRow,
    ...(sheet.dataStartRow !== undefined ? { dataStartRow: sheet.dataStartRow } : {}),
    requiredHeaders: sheet.requiredHeaders,
    identity: sheet.identity,
    fields,
    ...(sheet.extractAs !== undefined ? { extractAs: sheet.extractAs } : {}),
  };
}

/** Structural validation of a config document (returns issues; empty = valid). */
export function validateImportConfigDocument(doc: ImportConfigDocument): ImportConfigIssue[] {
  const issues: ImportConfigIssue[] = [];
  const push = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!doc.id || typeof doc.id !== "string") push("id", "a non-empty string id is required");
  if (!Number.isInteger(doc.version) || doc.version < 1) push("version", "version must be a positive integer");
  if (!doc.formatLabel) push("formatLabel", "a human formatLabel is required");
  if (!Array.isArray(doc.sheets) || doc.sheets.length === 0) {
    push("sheets", "at least one sheet configuration is required");
    return issues;
  }

  const sheetNames = new Set<string>();
  for (const [si, sheet] of doc.sheets.entries()) {
    const base = `sheets[${si}]`;
    if (!sheet.name) push(`${base}.name`, "sheet name is required");
    if (sheetNames.has(sheet.name)) push(`${base}.name`, `duplicate sheet name "${sheet.name}"`);
    sheetNames.add(sheet.name);
    if (!Array.isArray(sheet.sheetMatchers) || sheet.sheetMatchers.length === 0) {
      push(`${base}.sheetMatchers`, "at least one sheet-name matcher is required");
    } else {
      for (const [mi, src] of sheet.sheetMatchers.entries()) {
        try {
          new RegExp(src, "i");
        } catch {
          push(`${base}.sheetMatchers[${mi}]`, `invalid regex source: ${src}`);
        }
      }
    }
    if (!Number.isInteger(sheet.headerRow) || sheet.headerRow < 0) {
      push(`${base}.headerRow`, "headerRow must be a non-negative integer");
    }
    if (!Array.isArray(sheet.fields) || sheet.fields.length === 0) {
      push(`${base}.fields`, "at least one field mapping is required");
    }
    const keys = new Set<string>();
    for (const [fi, f] of (sheet.fields ?? []).entries()) {
      const fbase = `${base}.fields[${fi}]`;
      if (!f.key) push(`${fbase}.key`, "field key is required");
      if (keys.has(f.key)) push(`${fbase}.key`, `duplicate field key "${f.key}"`);
      keys.add(f.key);
      if (!f.header && !f.column) {
        push(`${fbase}`, `field "${f.key}" has neither header nor column — it can never be matched`);
      }
      if (f.column && !COLUMN_RE.test(f.column)) {
        push(`${fbase}.column`, `invalid column letter: ${f.column}`);
      }
      if (!f.concept) push(`${fbase}.concept`, `field "${f.key}" must document its canonical concept`);
      if (!f.role) push(`${fbase}.role`, `field "${f.key}" must declare a role`);
    }
    // Identity fields must resolve to actual mappings (by header OR key —
    // the UpsertMatcher resolves headers→keys with a key pass-through).
    // An EMPTY identity is legitimate for pure-insert sheets (REF: dedup
    // happens through the extractAs tables' UNIQUE constraints).
    if (!sheet.identity || !Array.isArray(sheet.identity.fields)) {
      push(`${base}.identity`, "identity is required (fields may be empty for insert-only sheets)");
    } else {
      const resolvable = new Set<string>();
      for (const f of sheet.fields) {
        if (f.header) resolvable.add(norm(f.header));
        resolvable.add(f.key);
      }
      for (const idField of sheet.identity.fields) {
        if (!resolvable.has(norm(idField)) && !resolvable.has(idField)) {
          push(`${base}.identity.fields`, `identity field "${idField}" resolves to no mapped field`);
        }
      }
      if (!["upsert", "insert"].includes(sheet.identity.strategy ?? "")) {
        push(`${base}.identity.strategy`, "strategy must be 'upsert' or 'insert'");
      }
    }
  }
  return issues;
}

/**
 * The central registry. A single instance (`importConfigRegistry`) is the
 * system-wide access point; it is seeded with the built-in format
 * documents (see `configs/`) but accepts `register()` calls at any time —
 * future admin-managed or DB-loaded configurations enter here.
 */
export class ImportConfigRegistry {
  private readonly docs = new Map<string, ImportConfigDocument>();
  private store: ImportConfigStore | null = null;

  /** Attach a pluggable store (future DB-backed persistence). */
  useStore(store: ImportConfigStore): void {
    this.store = store;
    for (const doc of store.list()) this.docs.set(doc.id, doc);
  }

  /** Validate + store a document. Returns the validation issues (empty = registered). */
  register(doc: ImportConfigDocument): readonly ImportConfigIssue[] {
    const issues = validateImportConfigDocument(doc);
    if (issues.length > 0) return issues;
    this.docs.set(doc.id, doc);
    this.store?.save(doc);
    return issues;
  }

  /** Latest version of a document by id, or an explicit pinned version. */
  get(id: string, version?: number): ImportConfigDocument | undefined {
    const doc = this.docs.get(id);
    if (!doc) return undefined;
    if (version === undefined || doc.version === version) return doc;
    return undefined; // (per-version history is a store concern — see useStore)
  }

  list(): readonly ImportConfigDocument[] {
    return [...this.docs.values()];
  }

  listSummaries(): readonly ImportConfigSummary[] {
    return this.list().map((d) => ({
      id: d.id,
      version: d.version,
      formatLabel: d.formatLabel,
      ...(d.academicYearHint !== undefined ? { academicYearHint: d.academicYearHint } : {}),
      enabled: d.enabled,
      sheetNames: d.sheets.map((s) => s.name),
    }));
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const doc = this.docs.get(id);
    if (!doc) return false;
    this.docs.set(id, { ...doc, enabled });
    return true;
  }

  /** Compile ONE document's sheets into runtime schemas (disabled → empty). */
  resolve(id: string): readonly ImportSchema[] {
    const doc = this.docs.get(id);
    if (!doc || !doc.enabled) return [];
    return doc.sheets.map(compileSheetConfig);
  }

  /**
   * Compile ALL enabled documents' sheets — the engine's schema universe.
   * Ordering: detectionPriority (ascending) then registration order, so
   * disambiguation examines the most specific formats first.
   */
  resolveAll(): readonly ImportSchema[] {
    const out: ImportSchema[] = [];
    for (const doc of this.list()) {
      if (!doc.enabled) continue;
      for (const sheet of doc.sheets) {
        out.push(compileSheetConfig(sheet));
      }
    }
    // Stable sort by the sheet's detectionPriority (default 100).
    const priorityOf = (s: ImportSchema): number => {
      for (const doc of this.list()) {
        const sheet = doc.sheets.find((x) => x.name === s.name);
        if (sheet) return sheet.detectionPriority ?? 100;
      }
      return 100;
    };
    return out
      .map((s, i) => ({ s, i, p: priorityOf(s) }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .map((x) => x.s);
  }

  /** Which configs declare a matcher for this sheet name (tier-1 shortlist). */
  identify(sheetName: string): readonly ImportSchema[] {
    return this.resolveAll().filter((s) =>
      s.sheetMatchers.some((re) => re.test(sheetName)),
    );
  }

  /**
   * FORMAT DETECTION (the mandate's "detect or select the appropriate
   * configuration"):
   *   1. Tier 1 — name match shortlist.
   *   2. If several candidates and a header row is available: the config
   *      whose requiredHeaders are ALL present wins; among full matches the
   *      MOST SPECIFIC signature (most requiredHeaders) wins; ties resolve
   *      by detectionPriority then array order.
   *   3. Single candidate → it.
   *   4. No name match + header row → tier-2 signature match (the classic
   *      engine behavior, preserved).
   */
  detect(
    sheetName: string,
    headerRow?: readonly string[] | null,
  ): ImportSchema | null {
    const candidates = this.identify(sheetName);
    if (candidates.length === 0) {
      // Tier 2: header signature on ALL enabled sheets (the legacy path).
      if (headerRow && headerRow.length > 0) {
        const normalized = new Set(headerRow.map((h) => norm(String(h ?? ""))));
        for (const schema of this.resolveAll()) {
          if (schema.requiredHeaders.length === 0) continue;
          if (schema.requiredHeaders.every((h) => normalized.has(norm(h)))) return schema;
        }
      }
      return null;
    }
    if (candidates.length === 1) return candidates[0];

    // Disambiguation by header signature.
    if (headerRow && headerRow.length > 0) {
      const normalized = new Set(headerRow.map((h) => norm(String(h ?? ""))));
      let best: { schema: ImportSchema; matched: number } | null = null;
      for (const schema of candidates) {
        if (schema.requiredHeaders.length === 0) continue;
        const matched = schema.requiredHeaders.filter((h) => normalized.has(norm(h))).length;
        const full = matched === schema.requiredHeaders.length;
        if (!full) continue;
        if (!best || matched > best.matched) best = { schema, matched };
      }
      if (best) return best.schema;
    }
    return candidates[0];
  }

  /** Explicit selection (the mandate's "or select") — resolves by config id. */
  selectConfig(configId: string): readonly ImportSchema[] {
    return this.resolve(configId);
  }
}
