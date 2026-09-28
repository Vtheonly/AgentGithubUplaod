/**
 * Date formatters — ISO 8601 in, localized FR out.
 */
import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function toDate(value: string | Date | number): Date | null {
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === "number") return isValid(new Date(value)) ? new Date(value) : null;
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    const d = parseISO(value);
    return isValid(d) ? d : null;
  }
  return null;
}

export function formatDate(value: string | Date | number, pattern = "dd/MM/yyyy"): string {
  const d = toDate(value);
  return d ? format(d, pattern, { locale: fr }) : "—";
}

export function formatDateTime(value: string | Date | number): string {
  return formatDate(value, "dd/MM/yyyy HH:mm");
}

export function formatRelative(value: string | Date | number): string {
  const d = toDate(value);
  return d ? formatDistanceToNow(d, { locale: fr, addSuffix: true }) : "—";
}

/**
 * T-435 (UI-317): format a tranche wave's due-date RANGE (min → max).
 *
 * On the official schedule every row of a wave carries the SAME date
 * (min === max — Sept 15 / Dec 15 / Mar 15 per `getOfficialTuitionDueDates`)
 * and the range degenerates to the single date. But the per-row échéance
 * editor (the Tranches tab's "Modifier l'échéance") and mid-year custom
 * schedules can move single rows; a wave whose dates spread must SHOW the
 * spread ("15 sept. 2026 → 15 oct. 2026"), never silently collapse to its
 * earliest date — a verdict a user cannot audit in place is
 * indistinguishable from a bug (§15.66b, extended from the verdict to its
 * driving fact).
 *
 * Null when the wave carries no parseable date (the caller keeps its
 * static schedule hint as the fallback line then).
 */
export function formatDueDateRange(
  dueDateMin: string | null,
  dueDateMax: string | null,
): string | null {
  if (!dueDateMin) return null;
  if (!dueDateMax || dueDateMax === dueDateMin) {
    return formatDate(dueDateMin, "dd MMM yyyy");
  }
  return `${formatDate(dueDateMin, "dd MMM yyyy")} → ${formatDate(dueDateMax, "dd MMM yyyy")}`;
}

export function toIsoDate(d: Date = new Date()): string {
  return d.toISOString();
}

export function toIsoDay(d: Date = new Date()): string {
  return format(d, "yyyy-MM-dd");
}

/**
 * Academic year is computed from current month: September or later → current year
 * starts a new academic year. (Mirrors Android AcademicYear computation.)
 */
export function currentAcademicYear(now: Date = new Date()): string {
  const year = now.getMonth() >= 8 /* 0-indexed Sept */ ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}
