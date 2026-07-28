/**
 * Unit tests for PII masking — plan §11.03.
 *
 * Covers every PII pattern type (phone, email, IBAN, NN, parent name,
 * student name), the round-trip (mask → unmask), and edge cases
 * (empty string, no PII, duplicate values).
 */
import { describe, it, expect } from "vitest";
import { maskPII, unmaskPII } from "../../domain/ai/pii-mask";

describe("maskPII — edge cases", () => {
  it("returns empty string + empty Map for empty input", () => {
    const result = maskPII("");
    expect(result.masked).toBe("");
    expect(result.replacements.size).toBe(0);
  });

  it("returns the original string + empty Map when no PII is present", () => {
    const text = "Bonjour, ceci est un message sans PII.";
    const result = maskPII(text);
    expect(result.masked).toBe(text);
    expect(result.replacements.size).toBe(0);
  });
});

describe("maskPII — phone numbers (Algerian formats)", () => {
  it("masks +213 555 123 456", () => {
    const result = maskPII("Appelez le +213 555 123 456 pour plus d'infos.");
    expect(result.masked).toContain("[PHONE_1]");
    expect(result.masked).not.toContain("+213 555 123 456");
    expect(result.replacements.get("[PHONE_1]")).toBe("+213 555 123 456");
  });

  it("masks 0555 123 456 (local mobile format)", () => {
    const result = maskPII("Tel: 0555 123 456");
    expect(result.masked).toContain("[PHONE_1]");
    expect(result.replacements.get("[PHONE_1]")).toBe("0555 123 456");
  });

  it("masks 213-555-123-456 (dashed format)", () => {
    const result = maskPII("Fax: 213-555-123-456");
    expect(result.masked).toContain("[PHONE_1]");
    expect(result.replacements.get("[PHONE_1]")).toBe("213-555-123-456");
  });
});

describe("maskPII — email addresses", () => {
  it("masks john@doe.com", () => {
    const result = maskPII("Contact: john@doe.com");
    expect(result.masked).toContain("[EMAIL_1]");
    expect(result.masked).not.toContain("john@doe.com");
    expect(result.replacements.get("[EMAIL_1]")).toBe("john@doe.com");
  });
});

describe("maskPII — IBAN (DZ + 22 digits)", () => {
  it("masks DZ1234567890123456789012", () => {
    const result = maskPII("IBAN: DZ1234567890123456789012");
    expect(result.masked).toContain("[IBAN_1]");
    expect(result.masked).not.toContain("DZ1234567890123456789012");
    expect(result.replacements.get("[IBAN_1]")).toBe("DZ1234567890123456789012");
  });
});

describe("maskPII — National ID (NN, 10 digits)", () => {
  it("masks a 10-digit Algerian NN", () => {
    const result = maskPII("NN: 1234567890");
    expect(result.masked).toContain("[NN_1]");
    expect(result.replacements.get("[NN_1]")).toBe("1234567890");
  });

  it("does NOT mask 9-digit or 11-digit numbers as NN", () => {
    const result = maskPII("Code 123456789 (9 chiffres) et 12345678901 (11 chiffres)");
    expect(result.masked).not.toContain("[NN_1]");
    // 11 digits might match the phone regex, but 9 digits should not be NN.
    // We only verify that 9-digit numbers are NOT treated as NN.
    expect(result.masked).toContain("123456789");
  });
});

describe("maskPII — parent and student names", () => {
  it("masks parent names from options.parentNames", () => {
    const result = maskPII(
      "Le parent Mohamed Ali est attendu demain.",
      { parentNames: ["Mohamed Ali"] },
    );
    expect(result.masked).toContain("[PARENT_1]");
    expect(result.masked).not.toContain("Mohamed Ali");
    expect(result.replacements.get("[PARENT_1]")).toBe("Mohamed Ali");
  });

  it("masks student names from options.studentNames", () => {
    const result = maskPII(
      "L'élève Amina Boumediene a obtenu 15/20.",
      { studentNames: ["Amina Boumediene"] },
    );
    expect(result.masked).toContain("[STUDENT_1]");
    expect(result.masked).not.toContain("Amina Boumediene");
    expect(result.replacements.get("[STUDENT_1]")).toBe("Amina Boumediene");
  });

  it("masks multiple parent names with separate placeholders", () => {
    const result = maskPII(
      "Mohamed Ali et Fatima Zahra sont convoqués.",
      { parentNames: ["Mohamed Ali", "Fatima Zahra"] },
    );
    expect(result.masked).toContain("[PARENT_1]");
    expect(result.masked).toContain("[PARENT_2]");
    expect(result.replacements.size).toBe(2);
  });
});

describe("maskPII — uniqueness", () => {
  it("two different phone numbers get [PHONE_1] and [PHONE_2]", () => {
    const result = maskPII("Tel1: +213 555 123 456, Tel2: +213 666 987 654");
    expect(result.masked).toContain("[PHONE_1]");
    expect(result.masked).toContain("[PHONE_2]");
    expect(result.replacements.size).toBe(2);
    expect(result.replacements.get("[PHONE_1]")).toBe("+213 555 123 456");
    expect(result.replacements.get("[PHONE_2]")).toBe("+213 666 987 654");
  });

  it("the same phone number appearing twice gets [PHONE_1] both times", () => {
    const result = maskPII("Tel: +213 555 123 456. Rappel: +213 555 123 456.");
    // Both occurrences should be replaced by the SAME placeholder.
    expect(result.masked).toContain("[PHONE_1]");
    expect(result.masked).not.toContain("+213 555 123 456");
    // Only one entry in the map (deduplicated).
    expect(result.replacements.size).toBe(1);
  });
});

describe("unmaskPII — round-trip", () => {
  it("restores the original text after masking", () => {
    const original =
      "Élève: Amina Boumediene. Tel parent: +213 555 123 456. Email: parent@example.com. IBAN: DZ1234567890123456789012. NN: 1234567890.";
    const { masked, replacements } = maskPII(original, {
      studentNames: ["Amina Boumediene"],
    });
    // Sanity: the masked string should NOT contain any of the original PII.
    expect(masked).not.toContain("Amina Boumediene");
    expect(masked).not.toContain("+213 555 123 456");
    expect(masked).not.toContain("parent@example.com");
    expect(masked).not.toContain("DZ1234567890123456789012");
    expect(masked).not.toContain("1234567890");
    // Round-trip restores the original.
    const restored = unmaskPII(masked, replacements);
    expect(restored).toBe(original);
  });

  it("returns the original string when no placeholders are present", () => {
    const text = "Aucun placeholder ici.";
    const result = unmaskPII(text, new Map());
    expect(result).toBe(text);
  });

  it("leaves unknown placeholders untouched", () => {
    const text = "Hello [UNKNOWN_1] world";
    const result = unmaskPII(text, new Map());
    expect(result).toBe(text);
  });
});
