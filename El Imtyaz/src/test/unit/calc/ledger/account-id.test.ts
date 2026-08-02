/**
 * Characterization tests for `calc/ledger/account-id.ts`.
 *
 * Verifies the deterministic account ID derivation matches the original
 * behavior exactly. Coverage target: 100%.
 */
import { describe, it, expect } from "vitest";
import { deriveAccountId } from "@/domain/calc/ledger/account-id";

describe("calc/ledger/account-id", () => {
  describe("deriveAccountId", () => {
    it("produces parent-scoped account ID without studentId", () => {
      expect(deriveAccountId("p1", "tuition")).toBe("parent:p1:category:tuition");
    });
    it("produces student-scoped account ID when studentId is provided", () => {
      expect(deriveAccountId("p1", "tuition", "s1")).toBe("parent:p1:category:tuition:student:s1");
    });
    it("treats null studentId the same as omitted studentId", () => {
      expect(deriveAccountId("p1", "transport", null)).toBe("parent:p1:category:transport");
    });
    it("treats empty string studentId as omitted (preserves original truthy check)", () => {
      // Original: `if (studentId) parts.push(...)` — empty string is falsy
      expect(deriveAccountId("p1", "transport", "")).toBe("parent:p1:category:transport");
    });
    it("works with all PaymentCategory values", () => {
      const categories = ["tuition", "transport", "canteen", "uniform", "books", "extracurricular", "other"] as const;
      for (const c of categories) {
        const id = deriveAccountId("p1", c);
        expect(id).toBe(`parent:p1:category:${c}`);
      }
    });
    it("is deterministic — same inputs always produce the same ID", () => {
      const a = deriveAccountId("parent-xyz", "tuition", "student-abc");
      const b = deriveAccountId("parent-xyz", "tuition", "student-abc");
      expect(a).toBe(b);
    });
    it("produces different IDs for different parents", () => {
      expect(deriveAccountId("p1", "tuition")).not.toBe(deriveAccountId("p2", "tuition"));
    });
    it("produces different IDs for different categories on the same parent", () => {
      expect(deriveAccountId("p1", "tuition")).not.toBe(deriveAccountId("p1", "transport"));
    });
    it("produces different IDs for parent-scoped vs student-scoped", () => {
      expect(deriveAccountId("p1", "tuition")).not.toBe(deriveAccountId("p1", "tuition", "s1"));
    });
    it("produces different IDs for different students on the same parent", () => {
      expect(deriveAccountId("p1", "tuition", "s1")).not.toBe(deriveAccountId("p1", "tuition", "s2"));
    });
  });
});
