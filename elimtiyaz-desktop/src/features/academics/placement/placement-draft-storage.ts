// ============================================================================
// FILE: src/features/academics/placement/placement-draft-storage.ts
// ============================================================================
// UI-346 (T-532, GitHub issue #32 §4 — the "Free List"): the ONE canonical
// definition of the Class Placement Studio's DRAFT persistence.
//
// SEMANTICS: the studio's in-session state (the student→class assignment
// map, the drafted sections, the existing-class patches, and the target
// year/grade selections) is WORKING STATE, not yet a committed
// constitution. Before this module it lived ONLY in component-local
// useState — leaving the Academics page, switching tabs, or restarting the
// application reset every completed step: the drafted sections vanished
// and every assigned student dropped back into the « Réserve » (the
// unassigned pool), forcing the operator to start the whole workflow over.
//
// This module persists that working state to localStorage — the same
// offline-cache contract as the dashboard layout storage (T-448/UI-326):
// the AUTHORITATIVE placement remains the server rows written by
// `finalizePlacements`; the draft is the operator's in-progress work,
// keyed per tenant + target year + target grade so concurrent-grade drafts
// never collide.
//
// The draft is RE-VALIDATED on restore (in the hook, against the live
// candidate pool and classes) — students removed or ineligible since the
// draft was saved drop out honestly; assignments to classes that no longer
// exist drop back to the reserve. Finalizing or deliberately resetting
// clears the draft (a completed workflow leaves no stale draft behind).
import type { GradeLevel } from "../../../domain/model/student";
import type { ClassDraft } from "../../../domain/calc/academics/class-placement";

export const PLACEMENT_DRAFT_STORAGE_PREFIX = "el-imtiyaz:placement-draft:";

/** The draft's serialization version — a mismatch discards the draft. */
export const PLACEMENT_DRAFT_VERSION = 1;

/** The persisted working state (Map objects serialized as entry arrays). */
export interface PersistedPlacementDraft {
  readonly version: number;
  readonly targetYearCode: string;
  readonly targetGradeLevel: GradeLevel;
  readonly assignedMap: ReadonlyArray<readonly [string, string | null]>;
  readonly customClassDrafts: readonly ClassDraft[];
  readonly modifiedClassPatches: ReadonlyArray<
    readonly [string, Partial<ClassDraft>]
  >;
  readonly savedAt: string;
}

export function placementDraftKey(
  tenant: string,
  yearCode: string,
  gradeLevel: string,
): string {
  return `${PLACEMENT_DRAFT_STORAGE_PREFIX}${tenant}:${yearCode}:${gradeLevel}`;
}

export function readPlacementDraft(key: string): PersistedPlacementDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPlacementDraft;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.version !== PLACEMENT_DRAFT_VERSION ||
      typeof parsed.targetYearCode !== "string" ||
      typeof parsed.targetGradeLevel !== "string" ||
      !Array.isArray(parsed.assignedMap) ||
      !Array.isArray(parsed.customClassDrafts) ||
      !Array.isArray(parsed.modifiedClassPatches)
    ) {
      // A malformed or future-versioned draft is discarded, never guessed at.
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePlacementDraft(
  key: string,
  draft: PersistedPlacementDraft,
): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // The studio remains fully usable when local persistence is
    // unavailable — the draft just will not survive the session.
  }
}

export function clearPlacementDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore persistence failures.
  }
}

/** Clears EVERY placement draft for the tenant (the reset-everything path). */
export function clearAllPlacementDrafts(tenant: string): void {
  try {
    const prefix = `${PLACEMENT_DRAFT_STORAGE_PREFIX}${tenant}:`;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // Ignore persistence failures.
  }
}
