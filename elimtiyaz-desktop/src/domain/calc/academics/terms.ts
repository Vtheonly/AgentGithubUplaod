/**
 * Current-term helpers — vault §09.04 "absences for the current term".
 *
 * The Algerian school year is divided into three trimesters:
 *   T1: Sep 1 – Dec 15
 *   T2: Dec 16 – Mar 15
 *   T3: Mar 16 – Jun 30
 * (July/August fall into the tail of T3 for summer-school purposes.)
 *
 * The absence-alert threshold (≥ 3 absences) is evaluated per CURRENT term —
 * never over a rolling window — so a fresh term gives every student a clean
 * slate, matching the vault's "count absences for current term" rule.
 */
import type { AcademicTerm } from "../../model/academic";

export interface TermWindow {
  readonly term: AcademicTerm;
  readonly start: Date;
  readonly end: Date;
  readonly label: string;
}

/**
 * Resolve the term containing `now` (defaults to the current wall-clock time).
 * Dates in July/August map to the tail of T3 of the school year that just
 * ended (the next school year has not started yet).
 */
export function currentTermWindow(now: Date = new Date()): TermWindow {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const day = now.getDate();

  const t1Start = new Date(year, 8, 1); // Sep 1
  const t1End = new Date(year, 11, 15); // Dec 15
  const t2End = new Date(year + 1, 2, 15); // Mar 15 next year
  const t3End = new Date(year + 1, 5, 30); // Jun 30 next year

  // Aug (and before Sep 1) → tail of previous year's T3.
  if (month < 8) {
    return {
      term: "T3",
      start: new Date(year - 1, 11, 16),
      end: new Date(year, 5, 30),
      label: `T3 ${year - 1}-${year}`,
    };
  }
  const nowDate = new Date(year, month, day);
  if (nowDate <= t1End) {
    return { term: "T1", start: t1Start, end: t1End, label: `T1 ${year}-${year + 1}` };
  }
  if (nowDate <= new Date(year + 1, 2, 15)) {
    return { term: "T2", start: new Date(year, 11, 16), end: t2End, label: `T2 ${year}-${year + 1}` };
  }
  return { term: "T3", start: new Date(year + 1, 2, 16), end: t3End, label: `T3 ${year}-${year + 1}` };
}

/** Whether an ISO date falls inside the current term window. */
export function isDateInCurrentTerm(dateIso: string, now: Date = new Date()): boolean {
  const t = new Date(dateIso).getTime();
  if (Number.isNaN(t)) return false;
  const w = currentTermWindow(now);
  return t >= w.start.getTime() && t <= w.end.getTime();
}
