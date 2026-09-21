// ============================================================================
// FILE: src/domain/calc/timetable/algerian-profile.ts
// ============================================================================
/**
 * The Algerian school configuration profile — T-404.
 *
 * DATA, NOT CODE: this is the TypeScript mirror of the DEFAULT row seeded
 * by migration 0109 §10 (`timetable_configurations`). The solver itself is
 * generic — it never imports this file; it reads whatever configuration
 * the problem carries. This module exists for:
 *  - mock mode / fresh-tenant defaults in the desktop UI,
 *  - the deterministic fixture (fixture.ts),
 *  - documentation of the expected Algerian week (Sun–Thu — the legacy
 *    mock `SchoolDay` type's Mon–Fri claim was wrong, SCHED-102).
 *
 * School week: Sunday → Thursday (weekend Friday + Saturday in Algeria).
 * Day: 4 morning periods (08:00), 15-min mid-morning break, lunch, then
 * 2 afternoon periods (13:00). 6 teaching periods/day, 30/week.
 */

import type {
  TimetableBreak,
  TimetableConfiguration,
  TimetableDay,
  TimetablePeriod,
} from "../../model/timetable";

export const ALGERIAN_SCHOOL_DAYS: readonly TimetableDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
];

export const ALGERIAN_PROFILE_LABEL = "Profil algérien standard";

export const ALGERIAN_PERIODS: readonly TimetablePeriod[] = [
  { index: 1, label: "S1", startMinutes: 8 * 60, endMinutes: 9 * 60 },
  { index: 2, label: "S2", startMinutes: 9 * 60, endMinutes: 10 * 60 },
  { index: 3, label: "S3", startMinutes: 10 * 60 + 15, endMinutes: 11 * 60 + 15 },
  { index: 4, label: "S4", startMinutes: 11 * 60 + 15, endMinutes: 12 * 60 + 15 },
  { index: 5, label: "S5", startMinutes: 13 * 60, endMinutes: 14 * 60 },
  { index: 6, label: "S6", startMinutes: 14 * 60, endMinutes: 15 * 60 },
];

export const ALGERIAN_BREAKS: readonly TimetableBreak[] = [
  {
    afterPeriodIndex: 2,
    label: "Pause",
    startMinutes: 10 * 60,
    endMinutes: 10 * 60 + 15,
  },
  {
    afterPeriodIndex: 4,
    label: "Déjeuner",
    startMinutes: 12 * 60 + 15,
    endMinutes: 13 * 60,
  },
];

/**
 * Build a NEW configuration object carrying the Algerian defaults for the
 * given tenant + academic year (used by mock mode and UI "reset to
 * default" actions; the LIVE default comes from migration 0109 §10).
 */
export function algerianDefaultConfiguration(
  tenantId: string,
  academicYearId: string,
  id = "cfg-algerian-default",
): TimetableConfiguration {
  const now = new Date().toISOString();
  return {
    id,
    tenantId,
    academicYearId,
    label: ALGERIAN_PROFILE_LABEL,
    schoolDays: ALGERIAN_SCHOOL_DAYS,
    periods: ALGERIAN_PERIODS,
    breaks: ALGERIAN_BREAKS,
    defaultLessonMinutes: 60,
    maxPeriodsPerDay: 6,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}
