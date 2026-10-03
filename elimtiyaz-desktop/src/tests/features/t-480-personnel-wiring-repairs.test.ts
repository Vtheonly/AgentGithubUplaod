/**
 * T-480 — the Personnel wiring repairs (the T-477 audit's findings):
 * CHAT-301 (the worker→supervisor chat deep link dead end-to-end),
 * WORKFORCE-509 (two assignee-ID split-brains), WORKFORCE-510 (three
 * swallowed justification Results) and DEAD-202 (the unreachable
 * personnel-detail-drawer).
 *
 * Pinned as source guards (the t-361/t-374 convention): each assertion
 * pins the EXACT repaired shape so a regression (a placeholder toast
 * reintroduced, a personnel-id filter resurrected, an error branch
 * dropped, the dead drawer restored) fails loudly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");

const WORKER_DASHBOARD = readFileSync(
  join(SRC, "features/personnel/dashboards/worker-dashboard.tsx"),
  "utf8",
);
const CHAT_PANEL = readFileSync(
  join(SRC, "features/personnel/management/chat-panel.tsx"),
  "utf8",
);
const PROFILE_DRAWER = readFileSync(
  join(SRC, "features/personnel/management/employee-profile-drawer.tsx"),
  "utf8",
);
const MANAGER_DASHBOARD = readFileSync(
  join(SRC, "features/personnel/dashboards/manager-dashboard.tsx"),
  "utf8",
);
const ATTENDANCE_CENTER = readFileSync(
  join(SRC, "features/personnel/management/staff-attendance-center.tsx"),
  "utf8",
);

describe("T-480 / CHAT-301 — the worker→supervisor chat deep link is real end-to-end", () => {
  it("worker-dashboard: the supervisor button calls onOpenChat, not a placeholder toast", () => {
    // The placeholder is GONE (the exact pre-T-480 string).
    expect(
      WORKER_DASHBOARD.includes(
        "Canal de discussion à venir dans une prochaine itération",
      ),
    ).toBe(false);
    // The button now routes through the deep link prop.
    expect(WORKER_DASHBOARD.includes("onOpenChat?.(supervisor.id)")).toBe(true);
  });

  it("chat-panel: the openWithPersonnelId effect no longer early-returns on the internal scope", () => {
    // The exact dead-guard line from the pre-T-480 effect (the T-463-era
    // comment + the !isPortal return) is gone.
    expect(
      CHAT_PANEL.includes("if (!isPortal) return;"),
    ).toBe(false);
    // The deep link resolves the recipient from personnel and creates the
    // direct channel for BOTH scopes (the idempotent create_direct_channel
    // RPC; the 0135 scope trigger derives the channel's scope server-side).
    expect(
      CHAT_PANEL.includes("person.id === openWithPersonnelId"),
    ).toBe(true);
    expect(
      CHAT_PANEL.includes("onOpenWithPersonnelHandled?.()"),
    ).toBe(true);
  });
});

describe("T-480 / WORKFORCE-509 — assignee filters match ACCOUNT ids (the T-371 key discipline)", () => {
  it("employee-profile-drawer: the Tâches tab filters on personnel.userId", () => {
    // The wrong-key predicate is gone…
    expect(
      PROFILE_DRAWER.includes("t.assigneeIds.includes(personnel.id)"),
    ).toBe(false);
    // …replaced by the account-id match (with the null guard).
    expect(
      PROFILE_DRAWER.includes(
        "personnel.userId !== null && t.assigneeIds.includes(personnel.userId)",
      ),
    ).toBe(true);
  });

  it("manager-dashboard: the team-task filter joins on team ACCOUNT ids", () => {
    // The wrong-key predicate is gone (personnel ids against account ids).
    expect(
      MANAGER_DASHBOARD.includes("t.assigneeIds.some((id) => teamIds.has(id))"),
    ).toBe(false);
    // …replaced by the account-id set (the leave/attendance filters KEEP
    // teamIds — those tables are personnel-keyed).
    expect(
      MANAGER_DASHBOARD.includes("teamAccountIds.has(id)"),
    ).toBe(true);
    expect(
      MANAGER_DASHBOARD.includes(
        "teamMembers.map((p) => p.userId).filter((id): id is string => id !== null)",
      ),
    ).toBe(true);
    // The personnel-keyed filters survive untouched (the correct keys for
    // leave_requests + workforce_attendance_events).
    expect(
      MANAGER_DASHBOARD.includes("leaveRequests.filter((r) => teamIds.has(r.personnelId)"),
    ).toBe(true);
    expect(
      MANAGER_DASHBOARD.includes("teamIds.has(e.personnelId)"),
    ).toBe(true);
  });
});

describe("T-480 / WORKFORCE-510 — the justification handlers surface rejected writes", () => {
  it("staff-attendance-center: all three handlers carry error branches", () => {
    // The pre-T-480 handlers had no else — count the error toasts the file
    // now carries on its justification paths (the clock punch already had
    // one from T-374; T-480 adds the three justification branches).
    const errorToastCount = (ATTENDANCE_CENTER.match(/toast\.showError\(/g) ?? []).length;
    expect(errorToastCount).toBeGreaterThanOrEqual(4); // 1 clock + 3 justification
    // Each new branch cites the rule.
    expect(ATTENDANCE_CENTER.includes("WORKFORCE-510")).toBe(true);
    expect(ATTENDANCE_CENTER.includes('toast.showError("Échec de l\'envoi", res.error.userMessage)')).toBe(true);
    expect(ATTENDANCE_CENTER.includes('toast.showError("Décision refusée", res.error.userMessage)')).toBe(true);
  });
});

describe("T-480 / DEAD-202 — the unreachable personnel-detail-drawer is deleted", () => {
  it("the file stays gone (a restored copy must re-prove reachability)", () => {
    expect(
      existsSync(join(SRC, "features/personnel/personnel-detail-drawer.tsx")),
    ).toBe(false);
  });
});
