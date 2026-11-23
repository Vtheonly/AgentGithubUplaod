// ============================================================================
// workflow-scheduled-runner/cron.ts — the pure 5-field cron evaluator
// ============================================================================
// T-584 (scheduled automation runner). Deno-free BY DESIGN (the
// `_shared/cron-auth.ts` precedent): this module is imported BOTH by the
// Edge Function index (Deno runtime) and by the desktop's mock event
// bridge + vitest suite (Node) — ONE implementation, zero parallel copies
// (recovery rule #10).
//
// SUPPORTED SYNTAX (the subset the workflow authors' inspector emits —
// `node-inspector-drawer.tsx` "Expression cron (min heure jour mois
// jour-semaine)"):
//   field 1  minute        0-59
//   field 2  hour          0-23
//   field 3  day-of-month  1-31
//   field 4  month         1-12
//   field 5  day-of-week   0-7 (0 and 7 are BOTH Sunday — Vixie cron)
// per field:  *  |  a  |  a-b  |  */n  |  a-b/n  |  a,b,c (each a list
// member may itself be a value, range or step-range)
//
// DOM/DOW SEMANTICS: the standard cron OR rule — when BOTH day-of-month
// and day-of-week are restricted (neither is `*`), a date matches if
// EITHER field matches; when only one is restricted it must match.
//
// The evaluator is MINUTE-granular: every cron instant is a whole minute.
// ============================================================================

export interface ParsedCron {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number> | null; // null = unrestricted (*)
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number> | null; // null = unrestricted (*)
}

export type CronParseResult =
  | { ok: true; cron: ParsedCron }
  | { ok: false; error: string };

const FIELD_BOUNDS: ReadonlyArray<{ min: number; max: number; name: string }> = [
  { min: 0, max: 59, name: "minute" },
  { min: 0, max: 23, name: "hour" },
  { min: 1, max: 31, name: "day-of-month" },
  { min: 1, max: 12, name: "month" },
  { min: 0, max: 7, name: "day-of-week" },
];

function parseField(
  raw: string,
  index: number,
): { ok: true; values: ReadonlySet<number> | null } | { ok: false; error: string } {
  const bounds = FIELD_BOUNDS[index];
  const text = raw.trim();
  if (text === "*") return { ok: true, values: null };

  const values = new Set<number>();
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) return { ok: false, error: `${bounds.name}: empty list member` };
    // [range]/step?
    const stepSplit = token.split("/");
    if (stepSplit.length > 2) {
      return { ok: false, error: `${bounds.name}: more than one '/' in '${token}'` };
    }
    const step = stepSplit.length === 2 ? Number(stepSplit[1]) : 1;
    if (!Number.isInteger(step) || step < 1) {
      return { ok: false, error: `${bounds.name}: invalid step '${stepSplit[1] ?? ""}'` };
    }
    let lo: number;
    let hi: number;
    const rangeText = stepSplit[0];
    if (rangeText === "*") {
      lo = bounds.min;
      hi = bounds.max;
    } else if (rangeText.includes("-")) {
      const [loRaw, hiRaw] = rangeText.split("-");
      if (loRaw === undefined || hiRaw === undefined) {
        return { ok: false, error: `${bounds.name}: malformed range '${rangeText}'` };
      }
      lo = Number(loRaw);
      hi = Number(hiRaw);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        return { ok: false, error: `${bounds.name}: non-integer range '${rangeText}'` };
      }
    } else {
      const v = Number(rangeText);
      if (!Number.isInteger(v)) {
        return { ok: false, error: `${bounds.name}: non-integer value '${rangeText}'` };
      }
      lo = v;
      hi = stepSplit.length === 2 ? bounds.max : v;
    }
    if (lo < bounds.min || hi > bounds.max || lo > hi) {
      return {
        ok: false,
        error: `${bounds.name}: '${token}' outside ${bounds.min}-${bounds.max}`,
      };
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  if (values.size === 0) {
    return { ok: false, error: `${bounds.name}: no values matched` };
  }
  return { ok: true, values };
}

/** The full inclusive range as a set — what `*` means for a field. */
function fullRange(min: number, max: number): ReadonlySet<number> {
  const s = new Set<number>();
  for (let v = min; v <= max; v++) s.add(v);
  return s;
}

export function parseCronExpression(expr: string): CronParseResult {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { ok: false, error: `expected 5 fields (min hour dom month dow), got ${fields.length}` };
  }
  const minute = parseField(fields[0], 0);
  if (!minute.ok) return minute;
  const hour = parseField(fields[1], 1);
  if (!hour.ok) return hour;
  const dom = parseField(fields[2], 2);
  if (!dom.ok) return dom;
  const month = parseField(fields[3], 3);
  if (!month.ok) return month;
  const dow = parseField(fields[4], 4);
  if (!dow.ok) return dow;
  return {
    ok: true,
    cron: {
      // `*` = the FULL range (an empty set would match nothing — the bug
      // the T-584 suite caught before it ever reached a deployment).
      minutes: minute.values ?? fullRange(0, 59),
      hours: hour.values ?? fullRange(0, 23),
      daysOfMonth: dom.values,
      months: month.values ?? fullRange(1, 12),
      daysOfWeek: dow.values === null ? null : normalizeDow(dow.values),
    },
  };
}

/** DOW 7 is an alias for Sunday (0) — fold it so membership checks are uniform. */
function normalizeDow(values: ReadonlySet<number>): ReadonlySet<number> {
  if (!values.has(7)) return values;
  const folded = new Set(values);
  folded.delete(7);
  folded.add(0);
  return folded;
}

/** Does the cron fire at the given instant (any whole-minute timestamp)? */
export function cronMatchesDate(cron: ParsedCron, at: Date): boolean {
  const minute = at.getUTCMinutes();
  const hour = at.getUTCHours();
  const dom = at.getUTCDate();
  const month = at.getUTCMonth() + 1;
  // JS getUTCDay(): 0=Sunday … 6=Saturday — same numbering as cron.
  const dow = at.getUTCDay();

  if (!cron.minutes.has(minute)) return false;
  if (!cron.hours.has(hour)) return false;
  if (!cron.months.has(month)) return false;

  const domRestricted = cron.daysOfMonth !== null;
  const dowRestricted = cron.daysOfWeek !== null;
  if (domRestricted && dowRestricted) {
    // Vixie OR rule: either side matching opens the day.
    return cron.daysOfMonth.has(dom) || cron.daysOfWeek.has(dow);
  }
  if (domRestricted) return cron.daysOfMonth.has(dom);
  if (dowRestricted) return cron.daysOfWeek.has(dow);
  return true;
}

export interface CronWindow {
  /** Window start, EXCLUSIVE (epoch ms). */
  readonly startMs: number;
  /** Window end, INCLUSIVE (epoch ms). */
  readonly endMs: number;
}

/**
 * Does the cron fire at least once inside the (startMs, endMs] window?
 *
 * The runner invokes this every 10 minutes with window =
 * (now - 10 min, now]. Adjacent windows are DISJOINT at the boundary —
 * an instant that fires exactly at a tick boundary is claimed by exactly
 * one window — so two consecutive ticks can never double-fire the same
 * cron instant, and a cron instant is never skipped while the scheduler
 * keeps ticking (the boundary instant belongs to the LATER window).
 */
export function cronFiresInWindow(cron: ParsedCron, window: CronWindow): boolean {
  if (window.endMs <= window.startMs) return false;
  // Scan whole minutes. The window start is EXCLUSIVE: the first candidate
  // is the first whole minute STRICTLY AFTER startMs (when startMs is
  // itself a whole minute, that minute belongs to the PREVIOUS window —
  // floor(startMs/60000)*60000 + 60000 always lands strictly after it).
  // The end is INCLUSIVE: the last candidate is floor(endMs/60000).
  const firstMin = Math.floor(window.startMs / 60_000) * 60_000 + 60_000;
  const lastMin = Math.floor(window.endMs / 60_000) * 60_000;
  for (let t = firstMin; t <= lastMin; t += 60_000) {
    if (cronMatchesDate(cron, new Date(t))) return true;
  }
  return false;
}
