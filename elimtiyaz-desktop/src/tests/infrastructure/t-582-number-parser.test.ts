/**
 * T-582 / BUG-052 — the import number-parser hardening suite.
 *
 * The registered defect (two traps in parseNumber):
 *   1. Currency stripping was the char-class `[DA€$]/gi` — it erased the
 *      LETTERS D and A anywhere in the string: "1D500" silently parsed as
 *      1500 (a payment amount corrupted at ingest, fail-open).
 *   2. The dot was never a thousands separator: "1.500" parsed as 1.5 —
 *      a 1000× under-read on FR-formatted amounts.
 *
 * The hardened contract (per the T-582 card):
 *   - Currency = a TRAILING whole token (DZD/DA/€/$) only.
 *   - The dot is thousands ONLY when followed by exactly 3 digits then a
 *     separator or the end; every other dot stays decimal.
 *   - The card's acceptance examples: "1D500" → error; "1.500" → 1500;
 *     "1.500,00" → 1500 (the per-rule resolution of "error-or-1500").
 *   - Every ambiguous/malformed input FAILS CLOSED (nan), never a guess.
 */
import { describe, it, expect } from "vitest";
import { parseNumber, positiveNumber } from "../../infrastructure/excel/import-engine/validators/rules/positive-number";
import type { FieldSpec } from "../../infrastructure/excel/import-engine/types";

const field: FieldSpec = { key: "amount", header: "Montant" } as FieldSpec;

describe("T-582 / BUG-052 — currency stripping is trailing-token only", () => {
  it("\"1D500\" → nan error (the letter-corruption trap is closed)", () => {
    const r = parseNumber("1D500");
    expect(r).toEqual({ error: "nan", raw: "1D500" });
  });

  it("\"DA500\" (leading token) → nan error — only TRAILING currency is stripped", () => {
    expect(parseNumber("DA500")).toEqual({ error: "nan", raw: "DA500" });
  });

  it("trailing DA / DZD / € / $ tokens are stripped correctly", () => {
    expect(parseNumber("500 DA")).toBe(500);
    expect(parseNumber("500DA")).toBe(500);
    expect(parseNumber("1 500 DZD")).toBe(1500);
    expect(parseNumber("1 500 dzd")).toBe(1500); // case-insensitive
    expect(parseNumber("45 000,00 DA")).toBe(45000);
    expect(parseNumber("500€")).toBe(500);
    expect(parseNumber("500 $")).toBe(500);
  });

  it("mid-string currency is REJECTED (not silently rewritten)", () => {
    expect(parseNumber("500 DA 12")).toEqual({ error: "nan", raw: "500 DA 12" });
  });
});

describe("T-582 / BUG-052 — the dot-as-thousands rule (exactly 3 digits + separator/end)", () => {
  it("the card's acceptance examples", () => {
    expect(parseNumber("1.500")).toBe(1500);
    expect(parseNumber("1.500,00")).toBe(1500);
  });

  it("multi-thousands chains collapse", () => {
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("12.345.678 DA")).toBe(12345678);
  });

  it("dot + comma-decimal (the mixed FR form) resolves to thousands + decimal", () => {
    expect(parseNumber("1.500,75")).toBe(1500.75);
    expect(parseNumber("45.000,00")).toBe(45000);
  });

  it("dots that are NOT followed by exactly 3 digits stay DECIMAL", () => {
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber("12.34")).toBe(12.34);
    expect(parseNumber("1500.5")).toBe(1500.5);
    expect(parseNumber("0.75")).toBe(0.75);
  });

  it("comma decimals keep the FR reading", () => {
    expect(parseNumber("45,5")).toBe(45.5);
    expect(parseNumber("1 234,56")).toBe(1234.56);
    expect(parseNumber("1500,00")).toBe(1500);
  });

  it("malformed mixed forms FAIL CLOSED (nan), never a guess", () => {
    expect(parseNumber("1,2,3")).toEqual({ error: "nan", raw: "1,2,3" });
    expect(parseNumber("1.500.00.00")).toEqual({ error: "nan", raw: "1.500.00.00" });
    expect(parseNumber("12..34")).toEqual({ error: "nan", raw: "12..34" });
  });
});

describe("T-582 — the preserved behaviors (regression guards)", () => {
  it("numbers, blanks, Excel errors, and negatives keep their verdicts", () => {
    expect(parseNumber(1500)).toBe(1500);
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("#REF!")).toEqual({ error: "ref", raw: "#REF!" });
    expect(parseNumber("#N/A")).toEqual({ error: "ref", raw: "#N/A" });
    expect(parseNumber("-500")).toBe(-500); // signed values pass through (bounds checked by the rule)
  });

  it("positiveNumber reports a nan issue for the letter-corruption form (the row is REJECTED, not silently imported)", () => {
    const issue = positiveNumber("1D500", field);
    expect(issue).not.toBeNull();
    expect(issue?.rule).toBe("positiveNumber");
    expect(issue?.field).toBe("amount");
  });

  it("positiveNumber accepts the trailing-currency and thousands forms the importer really sees", () => {
    expect(positiveNumber("45 000 DA", field)).toBeNull();
    expect(positiveNumber("1.500,00", field)).toBeNull();
    expect(positiveNumber("2500", field)).toBeNull();
  });
});
