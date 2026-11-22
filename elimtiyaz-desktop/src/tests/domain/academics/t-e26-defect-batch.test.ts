/**
 * E2.6 — the client-side defect batch: per-fix regression pins.
 *
 * One describe block per registered defect (BUG-001..005, 021, 023, 024 …),
 * each pinning the exact pre-fix misbehavior as a failing-before / green-after
 * contract. The defect list was re-verified at HEAD before each edit per the
 * E2.6 registry contract.
 */
import { describe, it, expect } from "vitest";
import { currentTermWindow, isDateInCurrentTerm } from "../../../domain/calc/academics/terms";

describe("E2.6 / BUG-001 — currentTermWindow's Jan–Mar predicate", () => {
  // The docstring's own windows: T1 Sep 1–Dec 15 · T2 Dec 16–Mar 15 · T3 Mar 16–Jun 30.
  it("Jan 10 is T2 of the school year that started the previous September", () => {
    const w = currentTermWindow(new Date(2027, 0, 10));
    expect(w.term).toBe("T2");
    expect(w.label).toBe("T2 2026-2027");
    expect(w.start.getTime()).toBe(new Date(2026, 11, 16).getTime());
    expect(w.end.getTime()).toBe(new Date(2027, 2, 15).getTime());
  });

  it("Feb 1 is T2 (previously misclassified as the previous year's T3 tail)", () => {
    const w = currentTermWindow(new Date(2027, 1, 1));
    expect(w.term).toBe("T2");
    expect(w.label).toBe("T2 2026-2027");
  });

  it("Mar 15 (inclusive) is still T2 — the boundary day", () => {
    const w = currentTermWindow(new Date(2027, 2, 15));
    expect(w.term).toBe("T2");
    expect(w.label).toBe("T2 2026-2027");
  });

  it("Mar 16 flips to T3 of the same school year (window starts Mar 16 of the launch year)", () => {
    const w = currentTermWindow(new Date(2027, 2, 16));
    expect(w.term).toBe("T3");
    expect(w.label).toBe("T3 2026-2027");
    // The 2026-2027 school year's T3 runs Mar 16 2027 → Jun 30 2027.
    expect(w.start.getTime()).toBe(new Date(2027, 2, 16).getTime());
    expect(w.end.getTime()).toBe(new Date(2027, 5, 30).getTime());
  });

  it("Jul 15 stays the tail of the previous year's T3 (summer rule preserved)", () => {
    const w = currentTermWindow(new Date(2027, 6, 15));
    expect(w.term).toBe("T3");
    expect(w.label).toBe("T3 2026-2027");
  });

  it("the Sep–Dec windows are unchanged: Sep 1 → T1, Dec 15 → T1, Dec 16 → T2", () => {
    expect(currentTermWindow(new Date(2026, 8, 1)).term).toBe("T1");
    expect(currentTermWindow(new Date(2026, 11, 15)).term).toBe("T1");
    expect(currentTermWindow(new Date(2026, 11, 16)).term).toBe("T2");
    expect(currentTermWindow(new Date(2026, 11, 16)).label).toBe("T2 2026-2027");
  });

  it("isDateInCurrentTerm: a Jan 5 absence counts in the T2 window (the clean-slate rule)", () => {
    const now = new Date(2027, 0, 10);
    expect(isDateInCurrentTerm("2027-01-05", now)).toBe(true); // inside T2
    expect(isDateInCurrentTerm("2026-12-20", now)).toBe(true); // T2 started Dec 16
    expect(isDateInCurrentTerm("2026-11-30", now)).toBe(false); // T1 — previous term, clean slate
  });
});
