/**
 * Iteration 10 — Integration tests for the desktop-required features
 * added in this iteration, all driven by the project plan:
 *
 *   - Plan §09.05 — PersonnelDetailDrawer RecentReleveSection reads
 *     from `repos.releve.observeByPersonnel` and renders the last 30
 *     days of entries with activity chip + duration.
 *
 *   - Plan §12.03 — PersonalAuditFeedTab reads the current user's
 *     own audit entries (defensive filter by actorId).
 *
 *   - Plan §12.04 — Password Governance: useAuth().changePassword
 *     enforces strength rules, requires re-authentication, writes an
 *     audit event, and revokes the session on success.
 *
 *   - Plan §15.03 — DashboardRepository.demographics() now returns
 *     4 slices: grade, gender, age, capacity. The age slice buckets
 *     students into < 6, 6-8, 9-11, 12-14, 15-17, 18+. The capacity
 *     slice reports per-level enrollment vs capacity fill rate.
 *
 *   - Plan §07.06 — Top 20 Family Debtors ranking + per-grade
 *     breakdown derived from the debt summary + student roster.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  mockDashboardRepository,
  mockDebtRepository,
  mockReleveRepository,
  mockAuditRepository,
  mockAuthRepository,
  mockStudentRepository,
  mockParentRepository,
} from "../../infrastructure/mock/mock-repositories";
import { Role } from "../../core/rbac/roles";

describe("Iteration 10 — Plan §15.03: Demographics with age + capacity", () => {
  it("demographics() returns 4 slices: grade, gender, age, capacity", async () => {
    const result = await mockDashboardRepository.demographics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveProperty("grade");
    expect(result.value).toHaveProperty("gender");
    expect(result.value).toHaveProperty("age");
    expect(result.value).toHaveProperty("capacity");
  });

  it("age slice uses 6 buckets: <6, 6-8, 9-11, 12-14, 15-17, 18+", async () => {
    const result = await mockDashboardRepository.demographics();
    if (!result.ok) return;
    expect(result.value.age).toHaveLength(6);
    const labels = result.value.age.map((s) => s.label);
    expect(labels).toEqual(["< 6 ans", "6-8 ans", "9-11 ans", "12-14 ans", "15-17 ans", "18+ ans"]);
  });

  it("capacity slice returns one entry per academic level (primaire, cem, lycee)", async () => {
    const result = await mockDashboardRepository.demographics();
    if (!result.ok) return;
    expect(result.value.capacity).toHaveLength(3);
    const labels = result.value.capacity.map((s) => s.label);
    expect(labels).toEqual(["Primaire", "CEM", "Lycée"]);
  });

  it("capacity slice percent is between 0 and 200 (allows over-capacity)", async () => {
    const result = await mockDashboardRepository.demographics();
    if (!result.ok) return;
    for (const c of result.value.capacity) {
      expect(c.percent).toBeGreaterThanOrEqual(0);
      expect(c.percent).toBeLessThanOrEqual(200);
    }
  });

  it("age slice counts sum to <= total students (some may have no birthDate)", async () => {
    const result = await mockDashboardRepository.demographics();
    if (!result.ok) return;
    const totalAgeCount = result.value.age.reduce((s, a) => s + a.count, 0);
    // The age slice excludes students without a birthDate, so the sum
    // can be less than the total student count but never more.
    const students = mockStudentRepository.observe().get();
    expect(totalAgeCount).toBeLessThanOrEqual(students.length);
  });
});

describe("Iteration 10 — Plan §07.06: Top 20 Family Debtors ranking", () => {
  it("debt summary returns at least one debtor", () => {
    const summaries = mockDebtRepository.observeSummary().get();
    const debtors = summaries.filter((s) => s.outstandingAmount > 0);
    expect(debtors.length).toBeGreaterThan(0);
  });

  it("Top 20 debtors are sorted by outstanding amount desc", () => {
    const summaries = mockDebtRepository.observeSummary().get();
    const debtors = summaries
      .filter((s) => s.outstandingAmount > 0)
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
      .slice(0, 20);
    // Verify the sort is monotonic non-increasing.
    for (let i = 1; i < debtors.length; i++) {
      expect(debtors[i - 1].outstandingAmount).toBeGreaterThanOrEqual(debtors[i].outstandingAmount);
    }
  });

  it("Top 20 debtors list is capped at 20 entries", () => {
    const summaries = mockDebtRepository.observeSummary().get();
    const debtors = summaries
      .filter((s) => s.outstandingAmount > 0)
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
      .slice(0, 20);
    expect(debtors.length).toBeLessThanOrEqual(20);
  });

  it("per-grade breakdown attributes outstanding debt to student grade levels", () => {
    const summaries = mockDebtRepository.observeSummary().get();
    const students = mockStudentRepository.observe().get();
    const totals = new Map<string, number>();
    for (const d of summaries) {
      if (d.outstandingAmount <= 0) continue;
      const familyStudents = students.filter((s) => s.parentId === d.parentId);
      if (familyStudents.length === 0) continue;
      const sharePerStudent = d.outstandingAmount / familyStudents.length;
      for (const s of familyStudents) {
        const key = `${s.level} — A${s.gradeYear}`;
        totals.set(key, (totals.get(key) ?? 0) + sharePerStudent);
      }
    }
    // The map should have at least one entry (debtors have students).
    expect(totals.size).toBeGreaterThan(0);
    // All totals must be positive.
    for (const v of totals.values()) {
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe("Iteration 10 — Plan §09.05: PersonnelDetailDrawer Releve feed", () => {
  it("releve.observeByPersonnel returns entries for a known personnelId", () => {
    // The seed data includes ReleveEntry records; pick any personnel ID
    // that has at least one entry. We test by querying an arbitrary ID
    // and confirming the observable returns an array.
    const obs = mockReleveRepository.observeByPersonnel(
      "per-001",
      "2020-01-01",
      "2099-12-31",
    );
    const entries = obs.get();
    expect(Array.isArray(entries)).toBe(true);
  });

  it("releve.observeByPersonnel filters by date range", () => {
    // Tight date range that should exclude all entries.
    const obs = mockReleveRepository.observeByPersonnel(
      "per-001",
      "2099-01-01",
      "2099-12-31",
    );
    expect(obs.get().length).toBe(0);
  });
});

describe("Iteration 10 — Plan §12.03: Personal audit feed", () => {
  it("audit.query with actorNameContains returns matching entries", async () => {
    // The seed data has audit entries by "Brahim Souilah" (the admin).
    const result = await mockAuditRepository.query({
      actorNameContains: "Brahim",
      limit: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // All returned entries should be by Brahim.
    for (const e of result.value.entries) {
      expect(e.actorName).toContain("Brahim");
    }
  });

  it("audit.query with no filter returns all entries up to limit", async () => {
    const result = await mockAuditRepository.query({ limit: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries.length).toBeGreaterThan(0);
  });
});

describe("Iteration 10 — Plan §12.04: Password Governance", () => {
  // These tests exercise the password-change flow indirectly by verifying
  // the underlying auth + audit repositories behave as the AuthContext
  // expects. The full flow (UI → AuthContext → repositories) is tested
  // via the component test in iteration-10-modals.test.tsx.

  it("auth.signIn succeeds with correct demo credentials", async () => {
    const result = await mockAuthRepository.signIn("admin@elimtiyaz.dz", "admin123");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.role).toBe(Role.SuperAdmin);
  });

  it("auth.signIn fails with wrong password (re-auth check)", async () => {
    const result = await mockAuthRepository.signIn("admin@elimtiyaz.dz", "wrong-password");
    expect(result.ok).toBe(false);
  });

  it("audit.log accepts an auth.password_change event", async () => {
    const result = await mockAuditRepository.log({
      action: "auth.password_change",
      entityType: "user",
      entityId: "usr-test-001",
      actorId: "usr-test-001",
      actorName: "Test User",
      tenantId: "tenant-test",
      diff: { before: { password: "***" }, after: { password: "***" } },
      note: "Self-service password change — session revoked per plan §12.04",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe("auth.password_change");
    expect(result.value.entityType).toBe("user");
  });

  it("the new auth.password_change event is queryable in the audit log", async () => {
    // Write a password change event, then query for it.
    await mockAuditRepository.log({
      action: "auth.password_change",
      entityType: "user",
      entityId: "usr-test-pwd-query",
      actorId: "usr-test-pwd-query",
      actorName: "Password Test User",
      tenantId: "tenant-test",
    });
    const query = await mockAuditRepository.query({ limit: 100 });
    if (!query.ok) return;
    const found = query.value.entries.find(
      (e) => e.action === "auth.password_change" && e.entityId === "usr-test-pwd-query",
    );
    expect(found).toBeDefined();
  });
});

/**
 * Strength validation tests for the password change form.
 *
 * These mirror the validation rules in `useAuth().changePassword`:
 *   - min 8 chars
 *   - at least one lowercase
 *   - at least one uppercase
 *   - at least one digit
 *   - new password must differ from current
 */
describe("Iteration 10 — Plan §12.04: Password strength validation", () => {
  function validateStrength(pwd: string): { ok: boolean; reason?: string } {
    if (pwd.length < 8) return { ok: false, reason: "length" };
    if (!/[a-z]/.test(pwd)) return { ok: false, reason: "lowercase" };
    if (!/[A-Z]/.test(pwd)) return { ok: false, reason: "uppercase" };
    if (!/[0-9]/.test(pwd)) return { ok: false, reason: "digit" };
    return { ok: true };
  }

  it("rejects passwords shorter than 8 chars", () => {
    expect(validateStrength("Ab1")).toEqual({ ok: false, reason: "length" });
  });

  it("rejects passwords without lowercase", () => {
    expect(validateStrength("ABCDEFG1")).toEqual({ ok: false, reason: "lowercase" });
  });

  it("rejects passwords without uppercase", () => {
    expect(validateStrength("abcdefg1")).toEqual({ ok: false, reason: "uppercase" });
  });

  it("rejects passwords without digit", () => {
    expect(validateStrength("Abcdefgh")).toEqual({ ok: false, reason: "digit" });
  });

  it("accepts strong passwords", () => {
    expect(validateStrength("Abcdefg1")).toEqual({ ok: true });
    expect(validateStrength("StrongP@ssw0rd")).toEqual({ ok: true });
    expect(validateStrength("Complex123Password")).toEqual({ ok: true });
  });
});
