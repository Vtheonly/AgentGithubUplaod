import { describe, it, expect } from "vitest";
import {
  splitFullName,
  isCompleteName,
} from "../../../infrastructure/excel/import-engine/mappers/name-splitter";

describe("name-splitter", () => {
  describe("splitFullName", () => {
    it("splits a simple two-token Latin name", () => {
      expect(splitFullName("Ahmed Benali")).toEqual({
        firstName: "Ahmed",
        lastName: "Benali",
      });
    });

    it("splits a French name with multiple last-name tokens", () => {
      expect(splitFullName("Jean De La Fontaine")).toEqual({
        firstName: "Jean",
        lastName: "De La Fontaine",
      });
    });

    it("treats a single token as last name with empty first name", () => {
      expect(splitFullName("Benali")).toEqual({
        firstName: "",
        lastName: "Benali",
      });
    });

    it("returns EMPTY for null/undefined/blank input", () => {
      expect(splitFullName(null)).toEqual({ firstName: "", lastName: "" });
      expect(splitFullName(undefined)).toEqual({ firstName: "", lastName: "" });
      expect(splitFullName("")).toEqual({ firstName: "", lastName: "" });
      expect(splitFullName("   ")).toEqual({ firstName: "", lastName: "" });
    });

    it("collapses internal whitespace", () => {
      expect(splitFullName("  Ahmed    Benali  ")).toEqual({
        firstName: "Ahmed",
        lastName: "Benali",
      });
    });

    it("handles Arabic names", () => {
      expect(splitFullName("محمد بن علي")).toEqual({
        firstName: "محمد",
        lastName: "بن علي",
      });
    });

    it("coerces non-string input", () => {
      expect(splitFullName(42)).toEqual({ firstName: "", lastName: "42" });
    });
  });

  describe("isCompleteName", () => {
    it("returns true when both first and last are non-empty", () => {
      expect(isCompleteName({ firstName: "Ahmed", lastName: "Benali" })).toBe(true);
    });

    it("returns false when first name is empty", () => {
      expect(isCompleteName({ firstName: "", lastName: "Benali" })).toBe(false);
    });

    it("returns false when last name is empty", () => {
      expect(isCompleteName({ firstName: "Ahmed", lastName: "" })).toBe(false);
    });
  });
});
