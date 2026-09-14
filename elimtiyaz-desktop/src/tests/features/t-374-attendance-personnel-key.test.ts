/**
 * T-374 (WORKFORCE-502) — the attendance punch uses the PERSONNEL key, never
 * a user_profiles.id fallback.
 *
 * Live console evidence (2026-09-14 05:56 UTC): two
 * `POST /rest/v1/workforce_attendance_events` calls failed HTTP 409.
 * The table (migration 0010) carries NO unique constraint — the 409 is a
 * SQLSTATE 23503 FOREIGN KEY violation: `worker-dashboard.tsx` derived
 * `personnelId = me?.id ?? session?.userId` and `staff-attendance-center.tsx`
 * derived `myPersonnelId = me?.id ?? currentUserId`. A signed-in user with
 * NO linked personnel record punched the clock with their user_profiles.id
 * → personnel_id FK violation → 409, twice (two punch attempts).
 *
 * The fix (this task): NO wrong-key fallback. Without a linked personnel
 * record the punch (and the leave-request submit — leave_requests
 * .personnel_id is the same FK) is refused with explicit guidance BEFORE
 * any server call; latestFor never runs with a foreign key; the
 * attendance center surfaces repository failures (the old path was silent).
 *
 * Pinned here as source guards (the t-361 convention) plus the live probe
 * evidence trail (scripts/t-374-attendance-probe.py).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");

const WORKER_DASHBOARD = readFileSync(
  join(SRC, "features/personnel/dashboards/worker-dashboard.tsx"),
  "utf8",
);
const ATTENDANCE_CENTER = readFileSync(
  join(SRC, "features/personnel/management/staff-attendance-center.tsx"),
  "utf8",
);

describe("T-374 — WORKFORCE-502: no user_profiles.id fallback on the personnel key", () => {
  it("worker-dashboard derives personnelId from the personnel record ONLY", () => {
    // The wrong-key ASSIGNMENT is gone (the exact statement form — a bare
    // string check would trip on the T-374 documentation comments).
    expect(
      WORKER_DASHBOARD.includes("const personnelId = me?.id ?? session?.userId"),
    ).toBe(false);
    expect(
      WORKER_DASHBOARD.includes("const personnelId = me?.id ?? currentUserId"),
    ).toBe(false);
    // …replaced by the honest null (no linked record ⇒ no punch).
    expect(WORKER_DASHBOARD.includes("const personnelId = me?.id ?? null;")).toBe(
      true,
    );
  });

  it("staff-attendance-center derives myPersonnelId from the personnel record ONLY", () => {
    expect(
      ATTENDANCE_CENTER.includes("const myPersonnelId = me?.id ?? currentUserId"),
    ).toBe(false);
    expect(ATTENDANCE_CENTER.includes("const myPersonnelId = me?.id ?? null;")).toBe(
      true,
    );
  });

  it("both clock paths refuse the punch BEFORE any server call when no personnel record is linked", () => {
    expect(
      WORKER_DASHBOARD.includes("if (!personnelId)") &&
        WORKER_DASHBOARD.includes("Pointage indisponible"),
    ).toBe(true);
    expect(
      ATTENDANCE_CENTER.includes("if (!myPersonnelId)") &&
        ATTENDANCE_CENTER.includes("Pointage indisponible"),
    ).toBe(true);
  });

  it("the leave-request submit carries the same guard (leave_requests.personnel_id is the same FK)", () => {
    expect(
      WORKER_DASHBOARD.includes("Demande indisponible") &&
        WORKER_DASHBOARD.includes("if (!personnelId)"),
    ).toBe(true);
  });

  it("latestFor never runs with a foreign key (both memo guards)", () => {
    expect(
      WORKER_DASHBOARD.includes(
        "return personnelId\n        ? repos.workforceAttendance.latestFor(personnelId, today)\n        : null;",
      ),
    ).toBe(true);
    expect(
      ATTENDANCE_CENTER.includes(
        "return myPersonnelId\n      ? repos.workforceAttendance.latestFor(myPersonnelId, todayIso)\n      : null;",
      ),
    ).toBe(true);
  });

  it("the attendance center surfaces repository failures (no silent error path)", () => {
    // The old handleRecordClock had `if (res.ok) { toast }` with NO else —
    // a WEAK-019-class silent failure. The error branch must stay.
    expect(
      ATTENDANCE_CENTER.includes("Erreur de pointage") &&
        ATTENDANCE_CENTER.includes("res.error.userMessage"),
    ).toBe(true);
  });
});
