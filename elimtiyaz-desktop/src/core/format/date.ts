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

/** A pure date-only string (`YYYY-MM-DD`) — a zone-less date fact. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * T-439 (UI-321): format a Date in UTC — date-fns formats in the machine's
 * LOCAL zone, so a UTC-midnight instant renders one day early on every
 * UTC-negative machine (Sept 15 stored → « 14 sept. 2026 » displayed —
 * proven: TZ=America/New_York failed 3 of the new t-434/t-435 échéance
 * pins). The shift-by-offset trick renders the UTC calendar date.
 */
function formatUtcParts(d: Date, pattern: string): string {
  const shifted = new Date(d.getTime() + d.getTimezoneOffset() * 60_000);
  return format(shifted, pattern, { locale: fr });
}

export function formatDate(value: string | Date | number, pattern = "dd/MM/yyyy"): string {
  const d = toDate(value);
  if (!d) return "—";
  // T-439 (UI-321): a DATE-ONLY fact has no zone — it parses to UTC
  // midnight and must RENDER in UTC (due dates, birth dates, paid dates).
  // A real DATETIME keeps its local rendering (a timestamp's wall time is
  // a local fact).
  if (typeof value === "string" && DATE_ONLY_RE.test(value.trim())) {
    return formatUtcParts(d, pattern);
  }
  return format(d, pattern, { locale: fr });
}

/**
 * T-439 (UI-321): the UTC-pinned formatter for callers whose values are
 * UTC-midnight ISO datetimes carrying DATE facts (the wave échéance
 * lines derive `new Date(min).toISOString()` — date-only facts in
 * datetime clothing). Every such surface renders the UTC calendar date
 * on every machine.
 */
export function formatDateUtc(value: string | Date | number, pattern = "dd/MM/yyyy"): string {
  const d = toDate(value);
  return d ? formatUtcParts(d, pattern) : "—";
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
  // T-439 (UI-321): the échéance dates are DATE facts carried as
  // UTC-midnight ISO — format in UTC so a UTC-negative machine never
  // shows the day before (the days-late suffix is pure UTC math; the
  // displayed date and the suffix must agree on the same card).
  if (!dueDateMax || dueDateMax === dueDateMin) {
    return formatDateUtc(dueDateMin, "dd MMM yyyy");
  }
  return `${formatDateUtc(dueDateMin, "dd MMM yyyy")} → ${formatDateUtc(dueDateMax, "dd MMM yyyy")}`;
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
