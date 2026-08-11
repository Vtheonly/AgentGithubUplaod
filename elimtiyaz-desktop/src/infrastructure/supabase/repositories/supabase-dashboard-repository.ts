/**
 * Supabase-backed DashboardRepository.
 *
 * CRITICAL FIX: This file fixes the long-standing bug where the dashboard
 * read from the MOCK store while the Excel importer wrote to Supabase. After
 * the fix, when `VITE_USE_SUPABASE=true`, the dashboard reads KPIs / revenue /
 * debt aging / demographics directly from the Supabase `parents`, `students`,
 * `payments`, and `ledger_entries` tables — the SAME tables the importer
 * populates. This makes the dashboard reflect the actual imported data
 * instead of always showing zeros (or stale seed-only numbers).
 *
 * The repository implements the full `DashboardRepository` interface:
 *   - kpis() / kpisForRange()           → counts + revenue + outstanding debt
 *   - revenueLast12Months() / revenueForRange()  → monthly paid-payments sum
 *   - debtByAging() / debtByAgingForRange()      → aging buckets from ledger
 *   - demographics()                            → grade / gender / age / capacity
 *
 * All reads use the anon-key client and respect RLS. The tenant_id is sourced
 * from the cached session (same helper as the rest of the Supabase layer).
 *
 * Reactive reads: like the other Supabase repositories, this wraps results in
 * a fresh fetch each call (no caching) because the dashboard already polls
 * on academic-year/range changes via `useEffect`. Adding a cache would just
 * add stale-data bugs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DashboardRepository,
  DateRange,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
  DemographicSlice,
} from "../../../domain/model/operations";
import type { AgingBucket } from "../../../domain/model/payment";
import { agingBucketFromDays } from "../../../domain/calc/payment";
import { academicLevelFromGradeLevel, type AcademicLevel, type GradeLevel } from "../../../domain/model/student";

// ============================================================================
// Helpers (mirror the helpers in supabase-shared-repositories.ts)
// ============================================================================

const TENANT_FALLBACK = "00000000-0000-0000-0000-000000000001";

function getSessionFromStorage(): { tenantId?: string; userId?: string; displayName?: string } | null {
  try {
    const raw = localStorage.getItem("el-imtiyaz.session");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getTenantId(): string {
  try {
    const sess = getSessionFromStorage();
    if (sess?.tenantId) return sess.tenantId;
  } catch { /* ignore */ }
  return TENANT_FALLBACK;
}

// ============================================================================
// Row shapes (minimal — only the columns this repository reads)
// ============================================================================

interface DashboardStudentRow {
  id: string;
  tenant_id: string;
  parent_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  grade_level_code: string | null;
  transport_tier: string | null;
  payment_plan: string | null;
  enrollment_status: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
}

interface DashboardPaymentRow {
  id: string;
  tenant_id: string;
  amount: number | string;
  method: string | null;
  status: string | null;
  category: string | null;
  collected_at: string | null;
  deleted_at: string | null;
}

interface DashboardLedgerRow {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  student_id: string | null;
  account_id: string | null;
  entry_type: string | null;
  amount: number | string;
  category: string | null;
  source_type: string | null;
  source_id: string | null;
  entry_date: string | null;
  at: string | null;
  metadata: Record<string, unknown> | null;
}

interface DashboardParentRow {
  id: string;
  tenant_id: string;
  deleted_at: string | null;
  is_active: boolean | null;
}

// ============================================================================
// SupabaseDashboardRepository
// ============================================================================

export class SupabaseDashboardRepository implements DashboardRepository {
  constructor(private readonly client: SupabaseClient) {}

  async kpis(): Promise<Result<DashboardKpi>> {
    return this.kpisForRange("current");
  }

  async revenueLast12Months(): Promise<Result<RevenuePoint[]>> {
    const now = new Date();
    const from = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    return this.fetchRevenueRange(from.getTime(), now.getTime());
  }

  async debtByAging(): Promise<Result<DebtByAgingBucket[]>> {
    return this.fetchDebtAging();
  }

  async demographics(): Promise<Result<{ grade: DemographicSlice[]; gender: DemographicSlice[]; age: DemographicSlice[]; capacity: DemographicSlice[] }>> {
    try {
      const tenantId = getTenantId();
      const { data, error } = await this.client
        .from("students")
        .select("gender, date_of_birth, grade_level_code, deleted_at, is_active")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);
      if (error) throw error;
      const rows = (data ?? []) as unknown as DashboardStudentRow[];
      const active = rows.filter((r) => r.is_active === null || r.is_active === true);

      const total = active.length;

      // Grade distribution — map grade_level_code → academic level.
      const levelCounts: Record<AcademicLevel, number> = { primaire: 0, cem: 0, lycee: 0 };
      let prescolaireCount = 0;
      for (const s of active) {
        const code = (s.grade_level_code ?? "").toLowerCase() as GradeLevel;
        // Treat preschool codes as prescolaire (separate bucket from primaire).
        if (code === "prescolaire_1" || code === "prescolaire_2") {
          prescolaireCount++;
          continue;
        }
        let level: AcademicLevel;
        try {
          level = academicLevelFromGradeLevel(code);
        } catch {
          level = "primaire";
        }
        levelCounts[level]++;
      }
      const totalWithLevels = levelCounts.primaire + levelCounts.cem + levelCounts.lycee + prescolaireCount;
      const grade: DemographicSlice[] = [
        { label: "Préscolaire", count: prescolaireCount, percent: totalWithLevels === 0 ? 0 : Math.round((prescolaireCount / totalWithLevels) * 100) },
        { label: "Primaire", count: levelCounts.primaire, percent: totalWithLevels === 0 ? 0 : Math.round((levelCounts.primaire / totalWithLevels) * 100) },
        { label: "CEM", count: levelCounts.cem, percent: totalWithLevels === 0 ? 0 : Math.round((levelCounts.cem / totalWithLevels) * 100) },
        { label: "Lycée", count: levelCounts.lycee, percent: totalWithLevels === 0 ? 0 : Math.round((levelCounts.lycee / totalWithLevels) * 100) },
      ];

      // Gender distribution.
      const male = active.filter((s) => s.gender === "male").length;
      const female = active.filter((s) => s.gender === "female").length;
      const other = total - male - female;
      const gender: DemographicSlice[] = [
        { label: "Garçons", count: male, percent: total === 0 ? 0 : Math.round((male / total) * 100) },
        { label: "Filles", count: female, percent: total === 0 ? 0 : Math.round((female / total) * 100) },
        { label: "Autre", count: other, percent: total === 0 ? 0 : Math.round((other / total) * 100) },
      ];

      // Age distribution.
      const now = new Date();
      const ageBuckets = [
        { label: "< 6 ans", min: 0, max: 5 },
        { label: "6-8 ans", min: 6, max: 8 },
        { label: "9-11 ans", min: 9, max: 11 },
        { label: "12-14 ans", min: 12, max: 14 },
        { label: "15-17 ans", min: 15, max: 17 },
        { label: "18+ ans", min: 18, max: 999 },
      ];
      const age: DemographicSlice[] = ageBuckets.map((b) => {
        const count = active.filter((s) => {
          if (!s.date_of_birth) return false;
          const birth = new Date(s.date_of_birth);
          const ageMs = now.getTime() - birth.getTime();
          const ageYears = Math.floor(ageMs / (365.25 * 86_400_000));
          return ageYears >= b.min && ageYears <= b.max;
        }).length;
        return { label: b.label, count, percent: total === 0 ? 0 : Math.round((count / total) * 100) };
      });

      // Capacity vs enrollment — we don't have a `classes` table populated
      // by the importer, so we report enrolled count per level with capacity 0
      // (the UI tolerates this and shows the enrolled count alone).
      const capacity: DemographicSlice[] = [
        { label: "Préscolaire", count: prescolaireCount, percent: 0 },
        { label: "Primaire", count: levelCounts.primaire, percent: 0 },
        { label: "CEM", count: levelCounts.cem, percent: 0 },
        { label: "Lycée", count: levelCounts.lycee, percent: 0 },
      ];

      return Ok({ grade, gender, age, capacity });
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async kpisForRange(academicYear: string, range?: DateRange): Promise<Result<DashboardKpi>> {
    try {
      const tenantId = getTenantId();
      const { fromMs, toMs } = this.computeRange(academicYear, range);

      // Fetch parents (count) — only non-deleted rows.
      const { data: parentRows, error: parentErr } = await this.client
        .from("parents")
        .select("id, deleted_at, is_active")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);
      if (parentErr) throw parentErr;
      const parents = (parentRows ?? []) as unknown as DashboardParentRow[];
      const totalParents = parents.length;

      // Fetch students (count).
      const { data: studentRows, error: studentErr } = await this.client
        .from("students")
        .select("id, deleted_at, is_active")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);
      if (studentErr) throw studentErr;
      const students = (studentRows ?? []) as unknown as DashboardStudentRow[];
      const totalStudents = students.length;

      // Fetch payments in range — sum PAID amounts for monthly revenue.
      const { data: paymentRows, error: paymentErr } = await this.client
        .from("payments")
        .select("id, amount, status, collected_at, deleted_at")
        .eq("tenant_id", tenantId);
      if (paymentErr) throw paymentErr;
      const payments = ((paymentRows ?? []) as unknown as DashboardPaymentRow[])
        .filter((p) => !p.deleted_at);
      const inRange = (ts: string | null) => {
        if (!ts) return false;
        const t = new Date(ts).getTime();
        return t >= fromMs && t < toMs;
      };
      const paymentsInRange = payments.filter((p) => inRange(p.collected_at));
      const monthlyRevenue = paymentsInRange
        .filter((p) => p.status === "paid")
        .reduce((s, p) => s + Number(p.amount), 0);

      // Fetch ledger entries — compute outstanding debt per parent.
      const { data: ledgerRows, error: ledgerErr } = await this.client
        .from("ledger_entries")
        .select("id, parent_id, account_id, entry_type, amount, category, source_type, source_id, entry_date, at, metadata")
        .eq("tenant_id", tenantId)
        .order("entry_date", { ascending: false })
        .limit(5000);
      if (ledgerErr) throw ledgerErr;
      const ledger = (ledgerRows ?? []) as unknown as DashboardLedgerRow[];

      // Compute outstanding per parent.
      const byParent = new Map<string, DashboardLedgerRow[]>();
      for (const e of ledger) {
        if (!e.parent_id) continue;
        const list = byParent.get(e.parent_id) ?? [];
        list.push(e);
        byParent.set(e.parent_id, list);
      }
      let outstandingDebt = 0;
      for (const [, entries] of byParent) {
        const totalCharged = entries
          .filter((e) => Number(e.amount) > 0 && e.entry_type !== "reversal" && e.entry_type !== "refund")
          .reduce((s, e) => s + Number(e.amount), 0);
        const totalPaid = entries
          .filter((e) => Number(e.amount) < 0 && (e.entry_type === "payment" || e.entry_type === "adjustment"))
          .reduce((s, e) => s + Math.abs(Number(e.amount)), 0);
        const balance = totalCharged - totalPaid;
        if (balance > 0.001) outstandingDebt += balance;
      }

      return Ok({
        totalStudents,
        totalParents,
        totalStaff: 0, // not tracked in Supabase for now
        monthlyRevenue,
        outstandingDebt,
        pendingExpenses: 0, // not tracked in Supabase for now
        attendanceRateToday: 0, // not tracked in Supabase for now
        overdueAlerts: 0, // computed by the alerts tab separately
      });
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async revenueForRange(academicYear: string, range?: DateRange): Promise<Result<RevenuePoint[]>> {
    const { fromMs, toMs } = this.computeRange(academicYear, range);
    return this.fetchRevenueRange(fromMs, toMs);
  }

  async debtByAgingForRange(academicYear: string, range?: DateRange): Promise<Result<DebtByAgingBucket[]>> {
    void academicYear;
    void range;
    return this.fetchDebtAging();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async fetchRevenueRange(fromMs: number, toMs: number): Promise<Result<RevenuePoint[]>> {
    try {
      const tenantId = getTenantId();
      const { data, error } = await this.client
        .from("payments")
        .select("amount, status, collected_at, deleted_at")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as DashboardPaymentRow[]).filter((p) => !p.deleted_at);

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
      for (const p of rows) {
        if (p.status !== "paid") continue;
        if (!p.collected_at) continue;
        const d = new Date(p.collected_at);
        const t = d.getTime();
        if (t < fromMs || t >= toMs) continue;
        const bucket = buckets.find((b) => b.year === d.getFullYear() && b.month === d.getMonth());
        if (bucket) bucket.amount += Number(p.amount);
      }
      return Ok(buckets.map((b) => ({ label: b.label, amount: b.amount })));
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  private async fetchDebtAging(): Promise<Result<DebtByAgingBucket[]>> {
    try {
      const tenantId = getTenantId();
      const { data, error } = await this.client
        .from("ledger_entries")
        .select("id, parent_id, account_id, entry_type, amount, category, source_type, source_id, entry_date, at, metadata")
        .eq("tenant_id", tenantId)
        .order("entry_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const ledger = (data ?? []) as unknown as DashboardLedgerRow[];

      const buckets: Record<string, { amount: number; debtorCount: number }> = {
        "0_30": { amount: 0, debtorCount: 0 },
        "31_60": { amount: 0, debtorCount: 0 },
        "61_90": { amount: 0, debtorCount: 0 },
        "91_180": { amount: 0, debtorCount: 0 },
        "180_plus": { amount: 0, debtorCount: 0 },
      };

      // Group by parent and compute balance + oldest overdue date.
      const byParent = new Map<string, DashboardLedgerRow[]>();
      for (const e of ledger) {
        if (!e.parent_id) continue;
        const list = byParent.get(e.parent_id) ?? [];
        list.push(e);
        byParent.set(e.parent_id, list);
      }

      const now = Date.now();
      for (const [, entries] of byParent) {
        const totalCharged = entries
          .filter((e) => Number(e.amount) > 0 && e.entry_type !== "reversal" && e.entry_type !== "refund")
          .reduce((s, e) => s + Number(e.amount), 0);
        const totalPaid = entries
          .filter((e) => Number(e.amount) < 0 && (e.entry_type === "payment" || e.entry_type === "adjustment"))
          .reduce((s, e) => s + Math.abs(Number(e.amount)), 0);
        const balance = totalCharged - totalPaid;
        if (balance <= 0.001) continue;

        // Find the oldest UNPAID charge's date to compute days overdue.
        const charges = entries
          .filter((e) => Number(e.amount) > 0 && e.entry_type !== "reversal" && e.entry_type !== "refund")
          .sort((a, b) => {
            const ta = new Date(a.at ?? a.entry_date ?? "").getTime();
            const tb = new Date(b.at ?? b.entry_date ?? "").getTime();
            return ta - tb;
          });
        if (charges.length === 0) continue;
        const oldestStr = charges[0].at ?? charges[0].entry_date ?? new Date().toISOString();
        const oldestMs = new Date(oldestStr).getTime();
        const daysOverdue = Math.max(0, Math.floor((now - oldestMs) / (86_400_000)));
        const bucket = agingBucketFromDays(daysOverdue);
        buckets[bucket].amount += balance;
        buckets[bucket].debtorCount += 1;
      }

      return Ok(
        (Object.entries(buckets) as Array<[string, { amount: number; debtorCount: number }]>).map(([bucket, data]) => ({
          bucket: bucket as AgingBucket,
          amount: data.amount,
          debtorCount: data.debtorCount,
        })),
      );
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * Resolve the academic year + optional range into a [fromMs, toMs) window.
   * Mirrors the mock implementation's computeRange logic.
   */
  private computeRange(academicYear: string, range?: DateRange): { fromMs: number; toMs: number } {
    let yearStart: number;
    let yearEnd: number;
    if (academicYear === "current" || !academicYear) {
      const now = new Date();
      const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      yearStart = new Date(startYear, 8, 1).getTime();
      yearEnd = new Date(startYear + 1, 8, 1).getTime();
    } else {
      const m = /^(\d{4})-(\d{4})$/.exec(academicYear);
      if (m) {
        const startYear = parseInt(m[1], 10);
        yearStart = new Date(startYear, 8, 1).getTime(); // Sep 1
        yearEnd = new Date(startYear + 1, 8, 1).getTime(); // Sep 1 next year
      } else {
        const now = new Date();
        const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
        yearStart = new Date(startYear, 8, 1).getTime();
        yearEnd = new Date(startYear + 1, 8, 1).getTime();
      }
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
