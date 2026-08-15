/**
 * Smoke test for the Dinero-backed DZD money adapter.
 */
import { describe, it, expect } from "vitest";
import {
  dzd, dzdFromSubunits, addDzd, subDzd, allocateDzd, toDzdNumber,
  dzdEqual, dzdIsZero, dzdGreaterThan, sumDzd, splitDzdEqually,
} from "../../../domain/calc/shared/money-dzd";

describe("money-dzd adapter — exact arithmetic invariants", () => {
  it("dzd: builds and round-trips", () => {
    expect(toDzdNumber(dzd(245_000))).toBe(245_000);
    expect(toDzdNumber(dzd(0))).toBe(0);
    expect(toDzdNumber(dzd(99.99))).toBe(99.99);
  });

  it("dzdFromSubunits", () => {
    expect(toDzdNumber(dzdFromSubunits(24_500_000))).toBe(245_000);
  });

  it("addDzd / subDzd: no float drift", () => {
    expect(toDzdNumber(addDzd(dzd(0.1), dzd(0.2)))).toBe(0.3);
    expect(toDzdNumber(subDzd(dzd(1), dzd(0.3)))).toBe(0.7);
  });

  it("allocateDzd: sum === total", () => {
    const total = dzd(100);
    const [a, b, c] = allocateDzd(total, [40, 30, 30]);
    expect(dzdEqual(addDzd(addDzd(a, b), c), total)).toBe(true);
  });

  it("allocateDzd: non-divisible", () => {
    const total = dzd(100);
    const [a, b, c] = allocateDzd(total, [1, 1, 1]);
    expect(dzdEqual(addDzd(addDzd(a, b), c), total)).toBe(true);
  });

  it("splitDzdEqually", () => {
    const total = dzd(245_000);
    const parts = splitDzdEqually(total, 3);
    expect(dzdEqual(sumDzd(parts, (p) => p), total)).toBe(true);
  });

  it("comparison helpers", () => {
    expect(dzdIsZero(dzd(0))).toBe(true);
    expect(dzdGreaterThan(dzd(2), dzd(1))).toBe(true);
  });

  it("sumDzd", () => {
    const items = [{ amount: dzd(100) }, { amount: dzd(200) }, { amount: dzd(50) }];
    expect(toDzdNumber(sumDzd(items, (i) => i.amount))).toBe(350);
  });
});
