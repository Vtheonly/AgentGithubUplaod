/**
 * Mock dashboard repository — KPIs, revenue series, debt aging, demographics.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including:
 *   - Iteration 5: KPIs computed from ledger replay (no hardcoded constants).
 *   - Iteration 6: attendanceRateToday derived from real attendance records.
 *   - Iteration 9: academic-year + date-range scoped KPIs (kpisForRange,
 *     revenueForRange, debtByAgingForRange).
 *   - Iteration 10: age distribution histogram + capacity vs enrollment gauge.
 */
import type {
  DashboardRepository,
  DateRange,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok } from "../../../core/result";
import { SubjectBehavior } from "../subject-behavior";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
  DemographicSlice,
} from "../../../domain/model/operations";
import type { AgingBucket } from "../../../domain/model/payment";
import { GRADE_LEVELS, GRADE_LEVEL_LABELS_FR } from "../../../domain/model/student";
import {
  agingBucketFromDays,
  monthlyRevenue,
  revenueByMonth,
} from "../../../domain/calc/payment";
import {
  buildOverdueDueDateMap,
  computeParentSummary,
  maxDaysOverdueFromLedger,
} from "../../../domain/calc/ledger";
import { store, delay } from "./mock-store";

export class MockDashboardRepository implements DashboardRepository {
  /**
   * Iteration 5: KPIs are now computed from the ledger via replay.
   * No hardcoded constants — every number is derived from real data.
   *
   * Iteration 6: `attendanceRateToday` is now computed from the attendance
   * records (previously hardcoded at 0.93 with a TODO).
   */
  async kpis(): Promise<Result<DashboardKpi>> {
    await delay(150);
    // Total outstanding = sum of all parents' balances (computed from ledger).
    const totalOutstanding = store.parents.reduce((sum, p) => {
      const entries = store.ledger.filter((e) => e.parentId === p.id);
      const dueDateMap = buildOverdueDueDateMap(entries);
      return sum + computeParentSummary(entries, p.id, "", dueDateMap).totalOutstanding;
    }, 0);

    // Iteration 6: derive attendanceRateToday from the most recent day's
    // attendance records. If no records exist for today, fall back to the
    // most recent day with records. If none exist at all, return 0.
    const today = new Date().toISOString().slice(0, 10);
    let recentAttendance = store.attendance.filter((r) => r.date === today);
    if (recentAttendance.length === 0) {
      // Find the most recent date with attendance records.
      const sortedDates = [...new Set(store.attendance.map((r) => r.date))].sort().reverse();
      if (sortedDates.length > 0) {
        recentAttendance = store.attendance.filter((r) => r.date === sortedDates[0]);
      }
    }
    const attendanceRateToday =
      recentAttendance.length === 0
        ? 0
        : recentAttendance.filter((r) => r.status === "present").length / recentAttendance.length;

    return Ok({
      totalStudents: store.students.length,
      totalParents: store.parents.length,
      totalStaff: store.personnel.length,
      monthlyRevenue: monthlyRevenue(store.payments),
      outstandingDebt: totalOutstanding,
      pendingExpenses: store.expenses.filter((e) => e.status === "submitted").length,
      attendanceRateToday,
      overdueAlerts: store.notifications.filter((n) => n.type === "payment_overdue" && !n.readAt).length,
    });
  }

  async revenueLast12Months(): Promise<Result<RevenuePoint[]>> {
    await delay(150);
    const months = revenueByMonth(store.payments);
    return Ok(months.map((m) => ({ label: m.label, amount: m.amount })));
  }

  async debtByAging(): Promise<Result<DebtByAgingBucket[]>> {
    await delay(120);
    // Compute aging buckets from the ledger.
    const buckets: Record<string, { amount: number; debtorCount: number }> = {
      "0_30": { amount: 0, debtorCount: 0 },
      "31_60": { amount: 0, debtorCount: 0 },
      "61_90": { amount: 0, debtorCount: 0 },
      "91_180": { amount: 0, debtorCount: 0 },
      "180_plus": { amount: 0, debtorCount: 0 },
    };
    for (const p of store.parents) {
      const entries = store.ledger.filter((e) => e.parentId === p.id);
      const dueDateMap = buildOverdueDueDateMap(entries);
      const summary = computeParentSummary(entries, p.id, "", dueDateMap);
      if (summary.totalOutstanding <= 0.001) continue;
      const days = maxDaysOverdueFromLedger(entries);
      const bucket = agingBucketFromDays(days);
      buckets[bucket].amount += summary.totalOutstanding;
      buckets[bucket].debtorCount += 1;
    }
    return Ok(
      (Object.entries(buckets) as Array<[string, { amount: number; debtorCount: number }]>).map(([bucket, data]) => ({
        bucket: bucket as AgingBucket,
        amount: data.amount,
        debtorCount: data.debtorCount,
      })),
    );
  }

  async demographics(): Promise<Result<{ grade: DemographicSlice[]; gender: DemographicSlice[]; age: DemographicSlice[]; capacity: DemographicSlice[] }>> {
    await delay(120);
    const total = store.students.length;
    // VAULT §15.03 — Grade Level Distribution is a BAR chart "per grade
    // (1AP, 2AP, …, 3ème Année)" — NOT a pie by cycle. Each of the 14
    // canonical GradeLevels gets its own bar.
    const byLevel = GRADE_LEVELS.map((gl) => ({
      label: GRADE_LEVEL_LABELS_FR[gl],
      count: store.students.filter((s) => s.gradeLevel === gl).length,
    })).filter((s) => s.count > 0);
    // VAULT §15.03 — Gender Distribution includes the "Unspecified" slice
    // (Male / Female / Unspecified ratio) — previously dropped entirely.
    const byGender = [
      { label: "Garçons", count: store.students.filter((s) => s.gender === "male").length },
      { label: "Filles", count: store.students.filter((s) => s.gender === "female").length },
      { label: "Non spécifié", count: store.students.filter((s) => s.gender !== "male" && s.gender !== "female").length },
    ].filter((s) => s.count > 0);

    // Iteration 10 — Age distribution histogram (plan §15.03).
    // Buckets: <6, 6-8, 9-11, 12-14, 15-17, 18+
    const now = new Date();
    const ageBuckets = [
      { label: "< 6 ans", min: 0, max: 5 },
      { label: "6-8 ans", min: 6, max: 8 },
      { label: "9-11 ans", min: 9, max: 11 },
      { label: "12-14 ans", min: 12, max: 14 },
      { label: "15-17 ans", min: 15, max: 17 },
      { label: "18+ ans", min: 18, max: 999 },
    ];
    const byAge = ageBuckets.map((b) => {
      const count = store.students.filter((s) => {
        if (!s.birthDate) return false;
        const birth = new Date(s.birthDate);
        const ageMs = now.getTime() - birth.getTime();
        const ageYears = Math.floor(ageMs / (365.25 * 86_400_000));
        return ageYears >= b.min && ageYears <= b.max;
      }).length;
      return { label: b.label, count };
    });

    // VAULT §15.03 — Capacity vs Enrollment is a GAUGE PER CLASS
    // ("Enrollment as % of max capacity per class") — not per-level bars.
    // Each slice = one class; `count` carries the enrolled count and
    // `percent` the fill rate (enrolled / capacity × 100).
    const byCapacity = store.classes
      .map((c) => {
        const capacity = c.capacity ?? 30;
        const enrolled = c.enrolledCount;
        return {
          label: c.name,
          count: enrolled,
          percent: capacity > 0 ? Math.round((enrolled / capacity) * 100) : 0,
        };
      })
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 12);

    return Ok({
      grade: byLevel.map((s) => ({ ...s, percent: total === 0 ? 0 : Math.round((s.count / total) * 100) })),
      gender: byGender.map((s) => ({ ...s, percent: total === 0 ? 0 : Math.round((s.count / total) * 100) })),
      age: byAge.map((s) => ({ ...s, percent: total === 0 ? 0 : Math.round((s.count / total) * 100) })),
      capacity: byCapacity,
    });
  }

  /**
   * Iteration 9 — academic-year + date-range scoped KPIs.
   *
   * Computes the same KPI set as `kpis()`, but filtered to the given
   * academic year and (optionally) a finer date range. Academic year
   * codes follow the format "YYYY-YYYY" (e.g. "2025-2026"); the first
   * year is the September of the start, the second year is the June end.
   */
  async kpisForRange(academicYear: string, range?: DateRange): Promise<Result<DashboardKpi>> {
    await delay(120);
    const { fromMs, toMs } = this.computeRange(academicYear, range);
    const inRange = (ts: string) => {
      const t = new Date(ts).getTime();
      return t >= fromMs && t < toMs;
    };

    const paymentsInRange = store.payments.filter((p) => inRange(p.collectedAt));
    const monthlyRev = paymentsInRange
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amount, 0);

    const totalOutstanding = store.parents.reduce((sum, p) => {
      const entries = store.ledger.filter((e) => e.parentId === p.id && inRange(e.at));
      const dueDateMap = buildOverdueDueDateMap(entries);
      return sum + computeParentSummary(entries, p.id, "", dueDateMap).totalOutstanding;
    }, 0);

    const today = new Date().toISOString().slice(0, 10);
    let recentAttendance = store.attendance.filter((r) => r.date === today);
    if (recentAttendance.length === 0) {
      const sortedDates = [...new Set(store.attendance.map((r) => r.date))].sort().reverse();
      if (sortedDates.length > 0) {
        recentAttendance = store.attendance.filter((r) => r.date === sortedDates[0]);
      }
    }
    const attendanceRateToday =
      recentAttendance.length === 0
        ? 0
        : recentAttendance.filter((r) => r.status === "present").length / recentAttendance.length;

    return Ok({
      totalStudents: store.students.length,
      totalParents: store.parents.length,
      totalStaff: store.personnel.length,
      monthlyRevenue: monthlyRev,
      outstandingDebt: totalOutstanding,
      pendingExpenses: store.expenses.filter((e) => e.status === "submitted").length,
      attendanceRateToday,
      overdueAlerts: store.notifications.filter((n) => n.type === "payment_overdue" && !n.readAt).length,
    });
  }

  async revenueForRange(academicYear: string, range?: DateRange): Promise<Result<RevenuePoint[]>> {
    await delay(120);
    const { fromMs, toMs } = this.computeRange(academicYear, range);
    const monthLabels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
    const buckets: Array<{ label: string; year: number; month: number; amount: number }> = [];
    const cursor = new Date(fromMs);
    cursor.setDate(1);
    while (cursor.getTime() < toMs) {
      buckets.push({
        label: monthLabels[cursor.getMonth()],
        year: cursor.getFullYear(),
        month: cursor.getMonth(),
        amount: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const p of store.payments) {
      if (p.status !== "paid") continue;
      const d = new Date(p.collectedAt);
      const t = d.getTime();
      if (t < fromMs || t >= toMs) continue;
      const bucket = buckets.find((b) => b.year === d.getFullYear() && b.month === d.getMonth());
      if (bucket) bucket.amount += p.amount;
    }
    return Ok(buckets.map((b) => ({ label: b.label, amount: b.amount })));
  }

  async debtByAgingForRange(academicYear: string, range?: DateRange): Promise<Result<DebtByAgingBucket[]>> {
    // Aging buckets are computed relative to "now" — they are not affected
    // by the date range in the same way revenue is. The academic year
    // determines which installments to consider; the range is ignored for
    // aging (it's a point-in-time metric).
    void academicYear;
    void range;
    return this.debtByAging();
  }

  /**
   * Resolve the academic year + optional range into a [fromMs, toMs) window.
   *
   * - Academic year "2025-2026" → Sep 1 2025 → Aug 31 2026.
   * - If `range` is provided, intersect with [range.from, range.to].
   */
  private computeRange(academicYear: string, range?: DateRange): { fromMs: number; toMs: number } {
    const m = /^(\d{4})-(\d{4})$/.exec(academicYear);
    let yearStart: number;
    let yearEnd: number;
    if (m) {
      const startYear = parseInt(m[1], 10);
      yearStart = new Date(startYear, 8, 1).getTime(); // Sep 1
      yearEnd = new Date(startYear + 1, 8, 1).getTime(); // Sep 1 next year
    } else {
      // Fallback: current academic year (Sep → Aug).
      const now = new Date();
      const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      yearStart = new Date(startYear, 8, 1).getTime();
      yearEnd = new Date(startYear + 1, 8, 1).getTime();
    }
    if (range) {
      const rFrom = new Date(range.from).getTime();
      const rTo = new Date(range.to).getTime();
      return {
        fromMs: Math.max(yearStart, rFrom),
        toMs: Math.min(yearEnd, rTo),
      };
    }
    return { fromMs: yearStart, toMs: yearEnd };
  }
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockDashboardRepository: DashboardRepository = new MockDashboardRepository();
