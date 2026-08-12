/**
 * Shared types + constants for the student-detail drawer sub-components.
 *
 * Extracted from `student-detail-drawer.tsx` (iteration 6-a). Behavior
 * preserved exactly — only file location + import paths changed.
 */
import type { AcademicTerm } from "../../../domain/model/academic";

/** Trimester codes used by the Academic tab's grade table. */
export const TERMS: AcademicTerm[] = ["T1", "T2", "T3"];
