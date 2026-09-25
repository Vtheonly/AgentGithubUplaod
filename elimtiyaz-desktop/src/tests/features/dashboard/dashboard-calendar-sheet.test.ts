/**
 * Dashboard calendar sheet — pure geometry of the month grid.
 *
 * `buildMonthSheet` is the function that decides what a "month" looks like in
 * the statistics/dashboard calendar, so it is pinned here as data, not as a
 * rendered snapshot:
 *
 *   - a FIXED 6-week (42 cell) sheet → the widget never jumps between 5 and 6
 *     rows while paging months;
 *   - Monday-first (WEEKDAYS_FR starts on Lun);
 *   - adjacent-month days are BORROWED (flagged `inMonth: false`) instead of
 *     leaving blank voids, so the page reads like an actual calendar;
 *   - cells are strictly consecutive (no gap, no duplicate, no repeat).
 *
 * `toDateKey` is pinned separately because it is the local-date contract that
 * replaced `Date.toISOString().slice(0, 10)` — a UTC key that drifts one day
 * back between 00:00 and 01:00 local time in Algeria (UTC+1).
 */
import { describe, it, expect } from "vitest";
import {
  buildMonthSheet,
  toDateKey,
} from "../../../features/dashboard/dashboard-calendar";

/** Weekday column of an ISO date, Monday = 0 … Sunday = 6. */
function mondayColumn(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function msOf(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

describe("toDateKey — local calendar date key", () => {
  it("formats a local Date as YYYY-MM-DD", () => {
    expect(toDateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(toDateKey(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("stays on the same key for every hour of the local day (no UTC drift)", () => {
    const keys = [
      ...new Set(
        Array.from({ length: 24 }, (_, h) => toDateKey(new Date(2026, 4, 15, h))),
      ),
    ];
    expect(keys).toEqual(["2026-05-15"]);
  });

  it("pads single-digit months and days", () => {
    expect(toDateKey(new Date(2026, 2, 5))).toBe("2026-03-05");
    expect(toDateKey(new Date(2026, 9, 9))).toBe("2026-10-09");
  });
});

describe("buildMonthSheet — the month page", () => {
  const CASES: ReadonlyArray<readonly [year: number, month: number]> = [
    [2026, 0],
    [2026, 1],
    [2026, 8],
    [2026, 11],
    [2028, 1],
    [2027, 5],
  ];

  it("always renders a fixed 6-week (42 cell) sheet", () => {
    for (const [year, month] of CASES) {
      expect(buildMonthSheet(year, month)).toHaveLength(42);
    }
  });

  it("is Monday-first: every cell sits in its own weekday column", () => {
    for (const [year, month] of CASES) {
      buildMonthSheet(year, month).forEach((cell, i) => {
        expect(mondayColumn(cell.date)).toBe(i % 7);
      });
    }
  });

  it("walks strictly consecutive days — no gap, no duplicate", () => {
    for (const [year, month] of CASES) {
      const sheet = buildMonthSheet(year, month);
      for (let i = 1; i < sheet.length; i++) {
        expect(msOf(sheet[i].date) - msOf(sheet[i - 1].date)).toBe(86_400_000);
      }
      expect(new Set(sheet.map((c) => c.date)).size).toBe(42);
    }
  });

  it("marks exactly the days of the requested month as inMonth", () => {
    for (const [year, month] of CASES) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const inMonth = buildMonthSheet(year, month).filter((c) => c.inMonth);
      expect(inMonth).toHaveLength(daysInMonth);
      expect(inMonth[0].day).toBe(1);
      expect(inMonth[inMonth.length - 1].day).toBe(daysInMonth);
      expect(inMonth.every((c) => c.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`))).toBe(true);
    }
  });

  it("borrows adjacent-month days instead of leaving blank voids (Février 2026)", () => {
    // 2026-02-01 is a Sunday → the sheet opens on Monday 2026-01-26.
    const sheet = buildMonthSheet(2026, 1);
    expect(sheet.slice(0, 6).map((c) => c.date)).toEqual([
      "2026-01-26",
      "2026-01-27",
      "2026-01-28",
      "2026-01-29",
      "2026-01-30",
      "2026-01-31",
    ]);
    expect(sheet.slice(0, 6).every((c) => !c.inMonth)).toBe(true);
    expect(sheet.filter((c) => c.inMonth)).toHaveLength(28);
  });

  it("keeps 29 days in a leap February (2028) and still pads to 42", () => {
    const sheet = buildMonthSheet(2028, 1);
    expect(sheet.filter((c) => c.inMonth)).toHaveLength(29);
    expect(sheet).toHaveLength(42);
  });

  it("crosses the year boundary when padding December", () => {
    // 2026-12-01 is a Tuesday → opens on Monday 2026-11-30, ends 2027-01-10.
    const sheet = buildMonthSheet(2026, 11);
    expect(sheet[0]).toEqual({ date: "2026-11-30", day: 30, inMonth: false });
    expect(sheet[sheet.length - 1]).toEqual({
      date: "2027-01-10",
      day: 10,
      inMonth: false,
    });
    expect(sheet.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it("never yields a blank cell — every cell carries a real date", () => {
    for (const [year, month] of CASES) {
      for (const cell of buildMonthSheet(year, month)) {
        expect(cell.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(cell.day).toBeGreaterThanOrEqual(1);
        expect(cell.day).toBeLessThanOrEqual(31);
      }
    }
  });
});
