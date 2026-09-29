/**
 * T-439 — UI-321 regression suite: date-only facts render in UTC on every
 * machine (the UTC-negative échéance day shift).
 *
 * THE BUG (registered before the fix per §13): `formatDate` parsed the
 * UTC-midnight ISO strings every due date is stored as, but formatted in
 * the machine's LOCAL zone — on every UTC-negative machine the new
 * échéance lines (T-434/T-435) displayed « 14 sept. 2026 » for a Sept 15
 * due date, and the days-late suffix (pure UTC math) then disagreed with
 * the displayed date on the same card. Proven: TZ=America/New_York failed
 * 3 of the t-434/t-435 assertions. Algeria (UTC+1) was unaffected — the
 * sessions ran under TZ=UTC/+1 and could not see it.
 *
 * THE FIX: date-only strings (YYYY-MM-DD) and the échéance range (whose
 * values are UTC-midnight ISO datetimes carrying DATE facts) format in
 * UTC; real datetimes keep their local wall-time rendering.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateUtc,
  formatDueDateRange,
} from "../../core/format/date";

const REAL_TZ = process.env.TZ;

beforeAll(() => {
  // The repro zone: UTC-4/-5 (New York) — the class of machines the
  // defect bites. Node re-reads process.env.TZ per Date call.
  process.env.TZ = "America/New_York";
});
afterEach(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("T-439 / UI-321 — date-only facts render in UTC (the UTC-negative machine)", () => {
  it("the zone is genuinely negative in this suite (the repro precondition)", () => {
    // Sept 15 UTC midnight is Sept 14 in New York — if this ever fails,
    // the repro environment changed and the suite must move with it.
    expect(new Date("2026-09-15T00:00:00.000Z").getDate()).toBe(14);
  });

  it("formatDateUtc renders the UTC calendar date for a UTC-midnight ISO (the échéance shape)", () => {
    expect(formatDateUtc("2026-09-15T00:00:00.000Z", "dd MMM yyyy")).toBe("15 sept. 2026");
  });

  it("formatDate renders a DATE-ONLY string in UTC (due/birth/paid dates)", () => {
    expect(formatDate("2026-09-15", "dd MMM yyyy")).toBe("15 sept. 2026");
    expect(formatDate("2026-09-15")).toBe("15/09/2026");
  });

  it("formatDueDateRange: the single-date and the min → max range render UTC dates", () => {
    expect(formatDueDateRange("2026-09-15T00:00:00.000Z", null)).toBe("15 sept. 2026");
    expect(formatDueDateRange("2026-09-15T00:00:00.000Z", "2026-09-15T00:00:00.000Z")).toBe(
      "15 sept. 2026",
    );
    expect(formatDueDateRange("2026-09-15T00:00:00.000Z", "2026-10-15T00:00:00.000Z")).toBe(
      "15 sept. 2026 → 15 oct. 2026",
    );
    expect(formatDueDateRange(null, "2026-10-15T00:00:00.000Z")).toBeNull();
  });

  it("a real DATETIME keeps its local wall-time rendering (a timestamp is a local fact)", () => {
    // 18:00 UTC is 14:00 in New York — the wall time renders.
    expect(formatDate("2026-09-15T18:00:00.000Z", "dd/MM/yyyy HH:mm")).toBe("15/09/2026 14:00");
  });
});
