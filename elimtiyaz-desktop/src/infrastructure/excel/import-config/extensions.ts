/**
 * Import extension points — T-414 (IMPORT-111 / ADR-026, 2026-09-26).
 *
 * THE MANDATE (issue #14): "Keep profile/entity matching as a future
 * extension point ONLY. Do not implement profile matching yet." The core
 * importer must NOT assume matching exists — it uses canonical entities
 * and these clearly defined interfaces.
 *
 * This module defines the plug-in surface future capabilities attach to.
 * Every interface ships with a NO-OP default so the engine runs with zero
 * extensions registered — and none of them are wired into the import path
 * yet beyond the seam where they will later plug in:
 *
 *   Excel → [ImportConfigRepository] → GenericEngine → CanonicalModel → ExistingBusinessLogic/Ledger
 *                              ▲ extensions attach HERE (config resolution, validation,
 *                                transformation, entity matching, reconciliation)
 *
 * DELIBERATELY NOT IMPLEMENTED (documented extension points only):
 *   - EntityMatcher / profile matching (the same real-world person appearing
 *     across multiple Excel sources, aggregated into one existing profile).
 *   - ReconciliationEngine (post-import cross-source reconciliation).
 *   - Additional ImportSourceAdapters (CSV, Google Sheets, …).
 *   - DB-backed ImportConfigStore (configurations as managed data rows).
 */
import type { ImportConfigDocument, ImportConfigIssue } from "./types";

// ---------------------------------------------------------------------------
// 1. The configuration store — where configurations LIVE
// ---------------------------------------------------------------------------

/**
 * Pluggable persistence for import configurations. The built-in store is
 * the compile-time registry (the `configs/` documents, version-controlled);
 * a future DB-backed store can serve admin-managed configurations without
 * touching the engine (the same register/load/validate contract).
 */
export interface ImportConfigStore {
  /** All stored documents (enabled AND disabled). */
  list(): readonly ImportConfigDocument[];
  /** Fetch one document by id (latest version). */
  get(id: string): ImportConfigDocument | undefined;
  /** Persist/replace a document (validates first; returns issues when invalid). */
  save(doc: ImportConfigDocument): readonly ImportConfigIssue[];
  /** Remove a document by id. */
  remove(id: string): boolean;
}

// ---------------------------------------------------------------------------
// 2. Entity / profile matching — FUTURE EXTENSION POINT (NOT IMPLEMENTED)
// ---------------------------------------------------------------------------

/** A canonical entity reference carried through the import pipeline. */
export interface CanonicalEntityRef {
  readonly kind: "parent" | "student";
  readonly id: string;
  /** Stable identity attributes available at import time. */
  readonly attributes: Readonly<Record<string, string | number | null>>;
}

/** The outcome of a future match attempt (discriminated union). */
export type EntityMatchOutcome = EntityMatchResult | EntityMatchSuccess;

/** No match — a new canonical entity must be created (current behavior). */
export interface EntityMatchResult {
  readonly matched: false;
  readonly reason?: string;
}
export interface EntityMatchSuccess {
  readonly matched: true;
  /** The EXISTING canonical entity this source record represents. */
  readonly target: CanonicalEntityRef;
  /** Match confidence + strategy (audit surface). */
  readonly confidence: number;
  readonly strategy: string;
}

/**
 * ENTITY MATCHER — the profile-matching extension point (issue #14:
 * "recognize that records from multiple sources represent the same
 * real-world person and aggregate their transactions into one existing
 * profile").
 *
 * NOT IMPLEMENTED. The default (`NoOpEntityMatcher`) always reports
 * "no match", so the importer creates canonical entities exactly as it
 * does today. A future implementation (phone/name/fuzzy strategies,
 * match-review queues) plugs in here WITHOUT redesigning the import
 * system: the storage adapter resolves parents/students through this
 * seam.
 */
export interface EntityMatcher {
  /** Attempt to resolve a source record to an existing canonical entity. */
  match(
    source: CanonicalEntityRef,
    existing: readonly CanonicalEntityRef[],
  ): Promise<EntityMatchOutcome>;
}

/** The no-op default — profile matching does not exist yet (by mandate). */
export class NoOpEntityMatcher implements EntityMatcher {
  async match(
    _source: CanonicalEntityRef,
    _existing: readonly CanonicalEntityRef[],
  ): Promise<EntityMatchResult> {
    return { matched: false, reason: "profile-matching not implemented (issue #14 future extension point)" };
  }
}

// ---------------------------------------------------------------------------
// 3. Validation + transformation + reconciliation seams (future modules)
// ---------------------------------------------------------------------------

/**
 * A config-driven validation rule beyond the engine's structural field
 * validation (cross-field invariants, business-rule gates per format).
 * Future modules register rules per config id; the engine's row pipeline
 * already emits structured issues these rules can extend.
 */
export interface ImportValidationRule {
  readonly id: string;
  readonly configId: string;
  /** Human description of what the rule guarantees. */
  readonly description: string;
}

/**
 * A post-import reconciliation hook — comparing imported canonical data
 * against the source workbook or another source (the mandate's
 * "reconciliation engines" future module). NOT IMPLEMENTED; documented so
 * the close-out reporting surface can grow without redesign.
 */
export interface ReconciliationHook {
  readonly id: string;
  readonly description: string;
  /** Future: run against a completed ImportContext + written entities. */
}

/**
 * A non-Excel import source (the mandate's "additional sources" future
 * module — CSV, Google Sheets, database dumps) compiled to the SAME
 * canonical record shape the engine already validates.
 */
export interface ImportSourceAdapter {
  readonly id: string;
  readonly description: string;
}

/**
 * The aggregate extension surface — what a future module registers with.
 * Kept as one interface so the extension registry itself can evolve
 * (add/replace modules) without touching the engine.
 */
export interface ImportExtensionPoints {
  readonly configStore?: ImportConfigStore;
  readonly entityMatcher?: EntityMatcher;
  readonly validationRules?: readonly ImportValidationRule[];
  readonly reconciliationHooks?: readonly ReconciliationHook[];
  readonly sourceAdapters?: readonly ImportSourceAdapter[];
}

/** The empty default — the engine runs with zero extensions. */
export const NO_EXTENSIONS: Readonly<Required<Pick<ImportExtensionPoints, "entityMatcher">>> & ImportExtensionPoints = {
  entityMatcher: new NoOpEntityMatcher(),
};
