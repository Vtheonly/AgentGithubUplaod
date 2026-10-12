/**
 * T-515 — the [Staff] working-DAYS calendar (WORKFORCE-516), the
 * regression suite.
 *
 * THE OWNER'S MANDATE (issue 3 of the three-issue fleet): "Remove the
 * working-hours configuration and keep only the working days of the month.
 * Make the working days configurable through toggles for each day of the
 * month. […] provide a calendar-based interface where users can select or
 * deselect working days. Based on the selected days, automatically
 * calculate and display the total number of working days for the selected
 * month."
 *
 * Layers pinned here:
 *   - the DOMAIN HELPERS (pure): daysInMonth (leap years), the school-week
 *     default (Dim–Jeu, never Ven/Sam), the month rollover;
 *   - the NORMALIZER (the live back-compat path): the LIVE singleton row's
 *     legacy `workingHours` shape (censused: scripts/t515-onboarding-
 *     census.json) loads cleanly on the new `workingDays` contract — the
 *     other fields preserved, the legacy key ignored, the absent key
 *     degraded to the documented default; garbage never throws;
 *   - the STEP (the mandate's surface): the calendar grid renders the
 *     month's every day as a toggle; toggling a day persists the exact
 *     payload; the month navigator rolls over; the quick selections; and
 *     the AUTO-COMPUTED TOTAL — the mandate's explicit display requirement;
 *   - the REVIEW row: the working-days count + the selected month.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import "../../../i18n/i18n";
import {
  daysInMonth,
  schoolWeekDaysOfMonth,
  defaultWorkingDays,
  normalizeWorkingDays,
  normalizeOnboardingData,
  type OnboardingState,
  type OnboardingData,
} from "../../../domain/model/workforce";
import { WorkingDaysStep } from "../../../features/personnel/onboarding/steps/working-days-step";
import { ReviewStep } from "../../../features/personnel/onboarding/steps/review-step";

/* ── The repository mock (the t-369 pattern) ────────────────────────── */

const updateDataMock = vi.fn();

function obs<T>(value: T) {
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      listeners.add(fn);
      fn(value);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** A fixed working-days config (October 2026: 31 days, the 1st is a Thursday). */
const OCTOBER_2026 = { year: 2026, month: 10, days: schoolWeekDaysOfMonth(2026, 10) };

let onboardingState: OnboardingState | null;

function makeOnboardingData(): OnboardingData {
  return {
    departments: [],
    roles: [],
    employeeCount: 10,
    adminIds: ["usr-1"],
    managerAssignments: [],
    workingDays: OCTOBER_2026,
    shiftTypes: ["morning"],
    permissionOverrides: {},
  };
}

function makeState(): Record<string, unknown> {
  return {
    onboarding: {
      observe: () => obs(onboardingState),
      updateData: updateDataMock,
    },
  };
}

let state: Record<string, unknown> = makeState();

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));

function setOnboarding(data: OnboardingData) {
  onboardingState = {
    tenantId: "t1",
    startedAt: "2026-10-13T00:00:00Z",
    completedAt: null,
    currentStep: "working_hours",
    completedSteps: new Set(),
    data,
  };
}

beforeEach(() => {
  cleanup();
  updateDataMock.mockReset();
  updateDataMock.mockResolvedValue({ ok: true });
  setOnboarding(makeOnboardingData());
  state = makeState();
});

/* ── The domain helpers (pure) ──────────────────────────────────────── */

describe("T-515 — the working-days domain helpers", () => {
  it("daysInMonth handles leap years and month lengths", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("the school-week default selects Dim–Jeu only (never Ven/Sam)", () => {
    // October 2026: the 1st is a Thursday, the 4th a Sunday, the 9th a Friday.
    const days = schoolWeekDaysOfMonth(2026, 10);
    expect(days).toHaveLength(21); // Thu×5 + Sun/Mon/Tue/Wed×4
    expect(days).not.toContain(9); // a Friday
    expect(days).not.toContain(10); // a Saturday
    expect(days).toContain(4); // a Sunday
    expect(days).toContain(1); // a Thursday
    expect([...days].sort((a, b) => a - b)).toEqual(days); // ascending
  });

  it("defaultWorkingDays is the current month on the school week", () => {
    const now = new Date(2026, 9, 13); // October 2026 (local)
    const d = defaultWorkingDays(now);
    expect(d.year).toBe(2026);
    expect(d.month).toBe(10);
    expect(d.days).toEqual(schoolWeekDaysOfMonth(2026, 10));
  });
});

/* ── The normalizer (the live back-compat path) ─────────────────────── */

describe("T-515 — normalizeOnboardingData (the legacy live row)", () => {
  it("the LIVE census shape (legacy workingHours, no workingDays) loads cleanly", () => {
    // The verbatim shape from scripts/t515-onboarding-census.json (the
    // singleton row read this session): the legacy key present, the new
    // key absent — the exact input the Supabase mapRow now normalizes.
    const legacyRow = {
      roles: [{ role: "teacher", count: 0 }],
      adminIds: ["1c4c5766-85f0-4292-a8a9-6ae8a20a69f3"],
      shiftTypes: ["morning", "night"],
      departments: [{ name: "Managers", color: "brand-blue", headId: null }],
      workingHours: { end: "17:00", start: "08:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
      employeeCount: 10,
      managerAssignments: [],
      permissionOverrides: {},
    };
    const d = normalizeOnboardingData(legacyRow);
    // The legacy key is IGNORED (no crash, no leakage into the new shape).
    expect((d as unknown as Record<string, unknown>).workingHours).toBeUndefined();
    // The new key degrades to the documented default (shape-valid).
    expect(d.workingDays.year).toBeGreaterThan(1900);
    expect(d.workingDays.month).toBeGreaterThanOrEqual(1);
    expect(d.workingDays.month).toBeLessThanOrEqual(12);
    expect(Array.isArray(d.workingDays.days)).toBe(true);
    // The OTHER fields are preserved verbatim.
    expect(d.employeeCount).toBe(10);
    expect(d.adminIds).toEqual(["1c4c5766-85f0-4292-a8a9-6ae8a20a69f3"]);
    expect(d.shiftTypes).toEqual(["morning", "night"]);
    expect(d.departments).toEqual([{ name: "Managers", color: "brand-blue", headId: null }]);
  });

  it("a valid new shape passes through untouched", () => {
    const data = makeOnboardingData();
    expect(normalizeOnboardingData(data)).toEqual(data);
  });

  it("garbage never throws (every field degrades to its default)", () => {
    const d = normalizeOnboardingData(null);
    expect(d.employeeCount).toBe(0);
    expect(d.workingDays.days).toEqual(schoolWeekDaysOfMonth(d.workingDays.year, d.workingDays.month));
    const d2 = normalizeOnboardingData({ workingDays: { year: "nope", month: 99, days: [1, 1, 0, 45, "x"] } });
    // The invalid days are dropped (out-of-range, non-numeric, deduped).
    expect(d2.workingDays.days.every((x) => typeof x === "number")).toBe(true);
    expect(new Set(d2.workingDays.days).size).toBe(d2.workingDays.days.length);
  });

  it("normalizeWorkingDays clamps days to the month's length and sorts", () => {
    const n = normalizeWorkingDays({ year: 2026, month: 2, days: [28, 29, 30, 1, 1, 3] });
    expect(n.days).toEqual([1, 3, 28]); // 29/30 dropped (2026 is not a leap year), deduped, sorted
  });
});

/* ── The step (the mandate's surface) ──────────────────────────────── */

describe("T-515 — WorkingDaysStep (the calendar)", () => {
  it("renders the month label and EVERY day of the month as a toggle", () => {
    render(<WorkingDaysStep />);
    expect(screen.getByTestId("wd-month-label").textContent).toContain("Octobre 2026");
    // 31 day cells for October.
    for (let day = 1; day <= 31; day++) {
      expect(screen.getByTestId(`wd-day-${day}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("wd-day-32")).not.toBeInTheDocument();
  });

  it("toggling a day persists the exact payload (select and deselect)", () => {
    render(<WorkingDaysStep />);
    const initial = schoolWeekDaysOfMonth(2026, 10);
    // Deselect an existing school-week day.
    fireEvent.click(screen.getByTestId("wd-day-4"));
    expect(updateDataMock).toHaveBeenCalledWith({
      workingDays: {
        year: 2026,
        month: 10,
        days: initial.filter((d) => d !== 4),
      },
    });
    // Select a non-school-week day (a Friday).
    fireEvent.click(screen.getByTestId("wd-day-9"));
    expect(updateDataMock).toHaveBeenCalledWith({
      workingDays: { year: 2026, month: 10, days: [...initial, 9].sort((a, b) => a - b) },
    });
  });

  it("the AUTO-COMPUTED TOTAL displays the selected count (the mandate's requirement)", () => {
    render(<WorkingDaysStep />);
    expect(screen.getByTestId("wd-total").textContent).toContain("21");
  });

  it("the month navigator rolls over the year", () => {
    render(<WorkingDaysStep />);
    // October → November.
    fireEvent.click(screen.getByTestId("wd-next-month"));
    expect(updateDataMock).toHaveBeenLastCalledWith({
      workingDays: { year: 2026, month: 11, days: schoolWeekDaysOfMonth(2026, 11) },
    });
    fireEvent.click(screen.getByTestId("wd-prev-month"));
    // The mock's updateData does not mutate the observable's state, so the
    // navigator still reads October → prev lands on September 2026.
    expect(updateDataMock).toHaveBeenLastCalledWith({
      workingDays: { year: 2026, month: 9, days: schoolWeekDaysOfMonth(2026, 9) },
    });
  });

  it("the quick selections (school week / all / none) persist their payloads", () => {
    render(<WorkingDaysStep />);
    fireEvent.click(screen.getByTestId("wd-select-all"));
    expect(updateDataMock).toHaveBeenLastCalledWith({
      workingDays: {
        year: 2026,
        month: 10,
        days: Array.from({ length: 31 }, (_, i) => i + 1),
      },
    });
    fireEvent.click(screen.getByTestId("wd-select-none"));
    expect(updateDataMock).toHaveBeenLastCalledWith({
      workingDays: { year: 2026, month: 10, days: [] },
    });
    fireEvent.click(screen.getByTestId("wd-school-week"));
    expect(updateDataMock).toHaveBeenLastCalledWith({
      workingDays: { year: 2026, month: 10, days: schoolWeekDaysOfMonth(2026, 10) },
    });
  });

  it("the selected state is visually marked (aria-pressed)", () => {
    render(<WorkingDaysStep />);
    expect(screen.getByTestId("wd-day-4").getAttribute("aria-pressed")).toBe("true"); // school week
    expect(screen.getByTestId("wd-day-9").getAttribute("aria-pressed")).toBe("false"); // a Friday
  });
});

/* ── The review row ────────────────────────────────────────────────── */

describe("T-515 — ReviewStep (the working-days row)", () => {
  it("displays the working-days count for the selected month", () => {
    render(<ReviewStep />);
    const row = screen.getByText("Jours ouvrés").closest("div");
    expect(row?.textContent).toContain("21 jour(s)");
    expect(row?.textContent).toContain("Octobre 2026");
  });
});
