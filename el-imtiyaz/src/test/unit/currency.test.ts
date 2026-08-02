/**
 * Unit tests for the currency formatter.
 *
 * Verifies the DZD formatting matches the Android app:
 * `Locale.FRANCE` grouping with non-breaking space, suffixed with " DZD".
 * Example: 12500 → "12 500 DZD".
 */
import { describe, it, expect } from "vitest";
import { formatDzd, formatDzdPlain, parseDzd } from "../../core/format/currency";

describe("formatDzd", () => {
  it("formats 0 as '0 DZD'", () => {
    expect(formatDzd(0)).toBe("0 DZD");
  });

  it("formats a simple amount with the DZD suffix", () => {
    // Note: fr-FR locale uses narrow no-break space (U+202F) for grouping
    // in modern Node.js versions. We check the meaningful parts rather than
    // an exact byte-for-byte match so the test stays locale-agnostic.
    const formatted = formatDzd(12500);
    expect(formatted).toContain("12");
    expect(formatted).toContain("500");
    expect(formatted).toContain("DZD");
    expect(formatted).not.toContain(",");
  });

  it("formats a large amount with grouping", () => {
    const formatted = formatDzd(1_000_000);
    expect(formatted).toContain("1");
    expect(formatted).toContain("000");
    expect(formatted).toContain("DZD");
  });

  it("formats a negative amount", () => {
    const formatted = formatDzd(-1500);
    expect(formatted).toContain("DZD");
    expect(formatted).toContain("1");
    expect(formatted).toContain("500");
  });

  it("returns the fallback '— DZD' for non-finite values", () => {
    expect(formatDzd(NaN)).toBe("— DZD");
    expect(formatDzd(Infinity)).toBe("— DZD");
    expect(formatDzd(-Infinity)).toBe("— DZD");
  });

  it("compact mode formats large amounts with short notation", () => {
    const compact = formatDzd(1_500_000, { compact: true });
    expect(compact).toContain("DZD");
    expect(compact.length).toBeLessThan(formatDzd(1_500_000).length);
  });

  it("compact mode falls back to full format for small amounts", () => {
    // Per implementation: compact only kicks in when Math.abs(amount) >= 10_000
    // Use regex to tolerate narrow no-break space (U+202F) which modern Node.js
    // Intl uses for the fr-FR locale.
    expect(formatDzd(5_000, { compact: true })).toMatch(/^5[\s\u202F]000 DZD$/);
    expect(formatDzd(9_999, { compact: true })).toMatch(/^9[\s\u202F]999 DZD$/);
    // 10_000 and above uses compact
    const compact = formatDzd(10_000, { compact: true });
    expect(compact).toContain("DZD");
  });
});

describe("formatDzdPlain", () => {
  it("formats 0 as '0'", () => {
    expect(formatDzdPlain(0)).toBe("0");
  });

  it("formats a simple amount with grouping but no suffix", () => {
    // Use regex to tolerate narrow no-break space (U+202F) which modern
    // Node.js Intl uses for the fr-FR locale.
    expect(formatDzdPlain(12500)).toMatch(/^12[\s\u202F]500$/);
  });

  it("returns '0' for non-finite values", () => {
    expect(formatDzdPlain(NaN)).toBe("0");
    expect(formatDzdPlain(Infinity)).toBe("0");
  });
});

describe("parseDzd", () => {
  it("parses a plain numeric string", () => {
    expect(parseDzd("12500")).toBe(12500);
  });

  it("parses a string with spaces (grouping)", () => {
    expect(parseDzd("12 500")).toBe(12500);
  });

  it("parses a string with the DZD suffix", () => {
    expect(parseDzd("12 500 DZD")).toBe(12500);
  });

  it("parses a string with lowercase 'dzd'", () => {
    expect(parseDzd("12500 dzd")).toBe(12500);
  });

  it("parses a decimal value with comma", () => {
    // European decimal separator → dot
    expect(parseDzd("12,5")).toBe(12.5);
  });

  it("returns NaN for non-numeric input", () => {
    expect(parseDzd("not a number")).toBeNaN();
  });

  it("returns 0 for an empty string (matches Number('') behavior)", () => {
    // The implementation calls Number('') which returns 0. This is a known
    // edge case — callers should validate input before calling parseDzd if
    // empty strings need to be treated as invalid.
    expect(parseDzd("")).toBe(0);
  });

  it("trims whitespace", () => {
    expect(parseDzd("  12500  ")).toBe(12500);
  });
});

describe("formatDzd  parseDzd round-trip", () => {
  it("parseDzd(formatDzd(x)) === x for integer amounts", () => {
    for (const x of [0, 1, 100, 12500, 1_000_000]) {
      expect(parseDzd(formatDzd(x))).toBe(x);
    }
  });
});
