/**
 * Characterization + unit tests for `calc/shared/dates.ts`.
 *
 * Coverage target: 100% lines + branches.
 */
import { describe, it, expect } from "vitest";
import {
  MS_PER_DAY,
  MONTH_LABELS_FR,
  toEpochMs,
  daysBetweenFloor,
  isStrictlyPast,
  isAtOrBefore,
  startOfMonth,
  endOfMonthExclusive,
  buildMonthlyBuckets,
} from "@/domain/calc/shared/dates";

describe("calc/shared/dates", () => {
  describe("constants", () => {
    it("MS_PER_DAY is 86_400_000 (24h × 60m × 60s × 1000ms)", () => {
      expect(MS_PER_DAY).toBe(24 * 60 * 60 * 1000);
    });
    it("MONTH_LABELS_FR has exactly 12 entries", () => {
      expect(MONTH_LABELS_FR).toHaveLength(12);
    });
    it("MONTH_LABELS_FR matches the original FR abbreviations", () => {
      expect([...MONTH_LABELS_FR]).toEqual([
        "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
        "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
      ]);
    });
  });

  describe("toEpochMs", () => {
    it("parses an ISO string to milliseconds", () => {
      expect(toEpochMs("2025-01-01T00:00:00.000Z")).toBe(Date.UTC(2025, 0, 1));
    });
    it("returns the ms value for an existing Date object", () => {
      const d = new Date("2025-06-15T12:00:00.000Z");
      expect(toEpochMs(d)).toBe(d.getTime());
    });
    it("returns NaN for an invalid string", () => {
      expect(Number.isNaN(toEpochMs("not-a-date"))).toBe(true);
    });
  });

  describe("daysBetweenFloor", () => {
    it("returns 0 for the same date", () => {
      const iso = "2025-01-10T00:00:00.000Z";
      expect(daysBetweenFloor(iso, iso)).toBe(0);
    });
    it("returns 1 for a 24h difference", () => {
      expect(daysBetweenFloor("2025-01-10T00:00:00.000Z", "2025-01-11T00:00:00.000Z")).toBe(1);
    });
    it("floors partial-day differences", () => {
      // 23h59m → 0 days (floor)
      expect(daysBetweenFloor("2025-01-10T00:00:00.000Z", "2025-01-10T23:59:59.999Z")).toBe(0);
    });
    it("returns 0 when later is before earlier (no negative days)", () => {
      expect(daysBetweenFloor("2025-01-11T00:00:00.000Z", "2025-01-10T00:00:00.000Z")).toBe(0);
    });
    it("returns 0 for invalid earlier date", () => {
      expect(daysBetweenFloor("bad", "2025-01-10T00:00:00.000Z")).toBe(0);
    });
    it("returns 0 for invalid later date", () => {
      expect(daysBetweenFloor("2025-01-10T00:00:00.000Z", "bad")).toBe(0);
    });
    it("computes 30 days for a full month", () => {
      expect(daysBetweenFloor("2025-01-01T00:00:00.000Z", "2025-01-31T00:00:00.000Z")).toBe(30);
    });
    it("accepts Date objects as inputs", () => {
      const a = new Date("2025-01-10T00:00:00.000Z");
      const b = new Date("2025-01-20T00:00:00.000Z");
      expect(daysBetweenFloor(a, b)).toBe(10);
    });
  });

  describe("isStrictlyPast", () => {
    it("returns true when iso is before now", () => {
      const now = new Date("2025-06-15T12:00:00.000Z");
      expect(isStrictlyPast("2025-06-15T11:59:59.999Z", now)).toBe(true);
    });
    it("returns false when iso equals now (strict less-than)", () => {
      const now = new Date("2025-06-15T12:00:00.000Z");
      expect(isStrictlyPast("2025-06-15T12:00:00.000Z", now)).toBe(false);
    });
    it("returns false when iso is after now", () => {
      const now = new Date("2025-06-15T12:00:00.000Z");
      expect(isStrictlyPast("2025-06-15T12:00:01.000Z", now)).toBe(false);
    });
  });

  describe("isAtOrBefore", () => {
    it("returns true when iso equals now", () => {
      const now = new Date("2025-06-15T12:00:00.000Z");
      expect(isAtOrBefore("2025-06-15T12:00:00.000Z", now)).toBe(true);
    });
    it("returns true when iso is before now", () => {
      const now = new Date("2025-06-15T12:00:00.000Z");
      expect(isAtOrBefore("2025-06-15T11:00:00.000Z", now)).toBe(true);
    });
    it("returns false when iso is after now", () => {
      const now = new Date("2025-06-15T12:00:00.000Z");
      expect(isAtOrBefore("2025-06-15T13:00:00.000Z", now)).toBe(false);
    });
  });

  describe("startOfMonth", () => {
    it("returns the first day of the same month at 00:00 local", () => {
      const d = new Date(2025, 5, 15, 12, 30, 45); // June 15, 2025 12:30:45 local
      const start = startOfMonth(d);
      expect(start.getFullYear()).toBe(2025);
      expect(start.getMonth()).toBe(5);
      expect(start.getDate()).toBe(1);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
    });
    it("handles January (month 0) without rolling back to previous year", () => {
      const d = new Date(2025, 0, 15);
      const start = startOfMonth(d);
      expect(start.getMonth()).toBe(0);
      expect(start.getFullYear()).toBe(2025);
    });
  });

  describe("endOfMonthExclusive", () => {
    it("returns the first day of the next month", () => {
      const d = new Date(2025, 5, 15); // June 15
      const end = endOfMonthExclusive(d);
      expect(end.getMonth()).toBe(6); // July
      expect(end.getDate()).toBe(1);
      expect(end.getFullYear()).toBe(2025);
    });
    it("rolls into next year for December", () => {
      const d = new Date(2025, 11, 15); // December 15
      const end = endOfMonthExclusive(d);
      expect(end.getMonth()).toBe(0); // January
      expect(end.getFullYear()).toBe(2026);
    });
  });

  describe("buildMonthlyBuckets", () => {
    it("returns 12 buckets by default, oldest first", () => {
      const now = new Date(2025, 5, 15); // June 2025
      const buckets = buildMonthlyBuckets(now);
      expect(buckets).toHaveLength(12);
      // First bucket = 11 months before June 2025 = July 2024
      expect(buckets[0].year).toBe(2024);
      expect(buckets[0].month).toBe(6); // July
      // Last bucket = June 2025
      expect(buckets[11].year).toBe(2025);
      expect(buckets[11].month).toBe(5); // June
    });
    it("starts each bucket's amount at 0", () => {
      const buckets = buildMonthlyBuckets(new Date(2025, 0, 1));
      for (const b of buckets) {
        expect(b.amount).toBe(0);
      }
    });
    it("labels each bucket with the FR month abbreviation", () => {
      const buckets = buildMonthlyBuckets(new Date(2025, 0, 1));
      const labels = buckets.map((b) => b.label);
      // 12 buckets ending at January 2025 → Feb 2024 … Jan 2025
      expect(labels).toContain("Jan");
      expect(labels).toContain("Déc");
      expect(new Set(labels).size).toBe(12); // all unique within the year span
    });
    it("honors a custom count", () => {
      const buckets = buildMonthlyBuckets(new Date(2025, 0, 1), 3);
      expect(buckets).toHaveLength(3);
      // 3 buckets ending at January 2025 → Nov 2024, Dec 2024, Jan 2025
      expect(buckets[0].month).toBe(10); // November
      expect(buckets[2].month).toBe(0);  // January
    });
  });
});
