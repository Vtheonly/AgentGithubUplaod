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
import { z } from "zod";
import { GRADE_LEVELS, type GradeLevel } from "../../../domain/model/student";
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

// T-628 / C-25: validate the complete version-1 wire shape before any
// consumer constructs Maps or reads section fields. Persisted JSON is untrusted.
const gradeSchema = z.custom<GradeLevel>(
  (value) => typeof value === "string" && GRADE_LEVELS.includes(value as GradeLevel),
);
const classDraftSchema = z.object({
  id: z.string().min(1), name: z.string(), section: z.string(),
  gradeCode: gradeSchema, level: z.enum(["primaire", "cem", "lycee"]),
  gradeYear: z.number().finite(), academicYearId: z.string(), academicYearCode: z.string(),
  filiereCode: z.string().nullable(), specialiteCode: z.string().nullable(),
  room: z.string().nullable(), capacity: z.number().finite().nullable(),
  homeroomTeacherId: z.string().nullable(), homeroomTeacherName: z.string().nullable(),
  notes: z.string().nullable(), isNew: z.boolean(),
}) satisfies z.ZodType<ClassDraft>;
// Infer the partial from the same object schema, rather than maintaining
// a second definition of the section fields.
const assignmentSchema = z.tuple([z.string().min(1), z.string().min(1).nullable()]);
const patchSchema = z.tuple([z.string().min(1), classDraftSchema.partial()]);
const persistedDraftSchema = z.object({
  version: z.literal(PLACEMENT_DRAFT_VERSION), targetYearCode: z.string().min(1),
  targetGradeLevel: gradeSchema, assignedMap: z.array(assignmentSchema),
  customClassDrafts: z.array(classDraftSchema), modifiedClassPatches: z.array(patchSchema),
  savedAt: z.string().datetime({ offset: true }),
});

export function readPlacementDraft(key: string): PersistedPlacementDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const result = persistedDraftSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    const draft = result.data;
    if (!key.endsWith(`:${draft.targetYearCode}:${draft.targetGradeLevel}`)) return null;
    // Duplicate identities would silently overwrite work in new Map().
    if (new Set(draft.assignedMap.map(([id]) => id)).size !== draft.assignedMap.length ||
        new Set(draft.modifiedClassPatches.map(([id]) => id)).size !== draft.modifiedClassPatches.length ||
        new Set(draft.customClassDrafts.map(({ id }) => id)).size !== draft.customClassDrafts.length) return null;
    if (draft.customClassDrafts.some((section) =>
      section.academicYearCode !== draft.targetYearCode || section.gradeCode !== draft.targetGradeLevel
    )) return null;
    return draft;
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
