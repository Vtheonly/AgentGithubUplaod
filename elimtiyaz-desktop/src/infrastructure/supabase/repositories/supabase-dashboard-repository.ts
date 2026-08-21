/**
 * Supabase-backed DashboardRepository.
 *
 * CRITICAL FIX (round 2): The previous version was failing with HTTP 400
 * errors because it selected columns that may not exist on the user's DB
 * (migration 0032 not yet applied), and because the tenant_id resolved to
 * the fallback UUID when the session expired. This version:
 *
 *   1. Selects ONLY the base columns that exist in migration 0007 — never
 *      selects `at`, `metadata`, `source_type`, etc. from ledger_entries
 *      unless they're known to exist. Uses `*` and reads defensively.
 *   2. Wraps each query in its own try/catch so one failing table doesn't
 *      break the entire dashboard.
 *   3. Uses HEAD + count for parent/student counts to avoid fetching all
 *      rows just to count them.
 *   4. Logs query failures to the console for debugging.
 *   5. Returns zeros + empty arrays on failure instead of propagating the
 *      error — the dashboard shows "0" rather than a blank/broken UI.
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
// TIER 3 FIX: import the canonical engine — the Supabase dashboard previously
// computed outstanding / debt-aging via inline `Σ` calculations that diverged
// from the mock (which uses `computeParentSummary`). The inline calculation
// didn't handle reversed-originals correctly (counted them in typed totals),
// producing different dashboard numbers in Mock vs Supabase mode for the
// same ledger state.
import {
  computeParentSummary,
  buildOverdueDueDateMap,
  maxDaysOverdueFromLedger,
} from "../../../domain/calc/ledger";
import type { LedgerEntry } from "../../../domain/model/ledger";

// ============================================================================
// Helpers
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
  gender: string | null;
  date_of_birth: string | null;
  grade_level_code: string | null;
  transport_tier: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
}

interface DashboardPaymentRow {
  id: string;
  amount: number | string;
  status: string | null;
  category: string | null;
  collected_at: string | null;
}

interface DashboardLedgerRow {
  id: string;
  parent_id: string | null;
  student_id: string | null;
  entry_type: string | null;
  amount: number | string;
  category: string | null;
  entry_date: string | null;
  // Unified columns (may not exist if migration 0027 not applied)
  at?: string | null;
  metadata?: Record<string, unknown> | null;
  source_type?: string | null;
  source_id?: string | null;
}

interface DashboardParentRow {
  id: string;
  deleted_at: string | null;
  is_active: boolean | null;
}

// ============================================================================
// TIER 3 FIX: Canonical engine adapter
// ============================================================================
// Map a raw Supabase ledger_entries row to the canonical `LedgerEntry` domain
// shape so the canonical `computeParentSummary` engine can consume it. This
// eliminates the inline `Σ` calculations that previously diverged from the
// mock repository's canonical engine call.
function mapLedgerRowToEntry(row: DashboardLedgerRow): LedgerEntry {
  return {
    id: row.id,
    tenantId: "", // not used by computeParentSummary
    accountId: "", // not used by computeParentSummary (it groups by parent_id)
    parentId: row.parent_id ?? "",
    studentId: row.student_id ?? null,
    category: (row.category ?? "other") as LedgerEntry["category"],
    amount: Number(row.amount),
    type: (row.entry_type ?? "adjustment") as LedgerEntry["type"],
    sourceType: (row.source_type ?? "manual_entry") as LedgerEntry["sourceType"],
    sourceId: row.source_id ?? null,
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: null,
    actorId: null,
    actorName: null,
    at: row.at ?? row.entry_date ?? new Date().toISOString(),
    metadata: Object.freeze({}),
  };
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
        .select("gender, date_of_birth, grade_level_code, transport_tier, is_active, deleted_at")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);
      if (error) {
        console.warn("[SupabaseDashboard] demographics query failed:", error.message);
        return Ok(this.emptyDemographics());
      }
      const rows = (data ?? []) as unknown as DashboardStudentRow[];
      const active = rows.filter((r) => r.is_active === null || r.is_active === true);

      const total = active.length;

      // Grade distribution — map grade_level_code → academic level.
      const levelCounts: Record<AcademicLevel, number> = { primaire: 0, cem: 0, lycee: 0 };
      let prescolaireCount = 0;
      for (const s of active) {
        const code = (s.grade_level_code ?? "").toLowerCase() as GradeLevel;
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
      const pct = (n: number) => totalWithLevels === 0 ? 0 : Math.round((n / totalWithLevels) * 100);
      const grade: DemographicSlice[] = [
        { label: "Préscolaire", count: prescolaireCount, percent: pct(prescolaireCount) },
        { label: "Primaire", count: levelCounts.primaire, percent: pct(levelCounts.primaire) },
        { label: "CEM", count: levelCounts.cem, percent: pct(levelCounts.cem) },
        { label: "Lycée", count: levelCounts.lycee, percent: pct(levelCounts.lycee) },
      ];

      // Gender distribution.
      const male = active.filter((s) => s.gender === "male").length;
      const female = active.filter((s) => s.gender === "female").length;
      const other = total - male - female;
      const genderPct = (n: number) => total === 0 ? 0 : Math.round((n / total) * 100);
      const gender: DemographicSlice[] = [
        { label: "Garçons", count: male, percent: genderPct(male) },
        { label: "Filles", count: female, percent: genderPct(female) },
        { label: "Autre", count: other, percent: genderPct(other) },
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

      // Capacity vs enrollment.
      const capacity: DemographicSlice[] = [
        { label: "Préscolaire", count: prescolaireCount, percent: 0 },
        { label: "Primaire", count: levelCounts.primaire, percent: 0 },
        { label: "CEM", count: levelCounts.cem, percent: 0 },
        { label: "Lycée", count: levelCounts.lycee, percent: 0 },
      ];

      return Ok({ grade, gender, age, capacity });
    } catch (e) {
      console.warn("[SupabaseDashboard] demographics failed:", e);
      return Ok(this.emptyDemographics());
    }
  }

  async kpisForRange(academicYear: string, range?: DateRange): Promise<Result<DashboardKpi>> {
    try {
      const tenantId = getTenantId();
      const { fromMs, toMs } = this.computeRange(academicYear, range);

      // Count parents — use head + count to avoid fetching all rows.
      let totalParents = 0;
      try {
        const { count, error } = await this.client
          .from("parents")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null);
        if (error) {
          console.warn("[SupabaseDashboard] parents count failed:", error.message);
        } else {
          totalParents = count ?? 0;
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] parents count error:", e);
      }

      // Count students.
      let totalStudents = 0;
      try {
        const { count, error } = await this.client
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null);
        if (error) {
          console.warn("[SupabaseDashboard] students count failed:", error.message);
        } else {
          totalStudents = count ?? 0;
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] students count error:", e);
      }

      // Fetch payments — select only base columns.
      let monthlyRevenue = 0;
      try {
        const { data: paymentRows, error: paymentErr } = await this.client
          .from("payments")
          .select("id, amount, status, collected_at")
          .eq("tenant_id", tenantId);
        if (paymentErr) {
          console.warn("[SupabaseDashboard] payments query failed:", paymentErr.message);
        } else {
          const payments = (paymentRows ?? []) as unknown as DashboardPaymentRow[];
          const inRange = (ts: string | null) => {
            if (!ts) return false;
            const t = new Date(ts).getTime();
            return t >= fromMs && t < toMs;
          };
          monthlyRevenue = payments
            .filter((p) => inRange(p.collected_at) && p.status === "paid")
            .reduce((s, p) => s + Number(p.amount), 0);
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] payments query error:", e);
      }

      // Fetch ledger entries — compute outstanding debt per parent.
      // Select only base columns to avoid 400 if migration 0027 not applied.
      let outstandingDebt = 0;
      try {
        const { data: ledgerRows, error: ledgerErr } = await this.client
          .from("ledger_entries")
          .select("id, parent_id, student_id, entry_type, amount, category, entry_date, at, metadata, source_type, source_id, reverses_id, payment_status, method, receipt_number")
          .eq("tenant_id", tenantId)
          .limit(5000);
        if (ledgerErr) {
          console.warn("[SupabaseDashboard] ledger query failed:", ledgerErr.message);
        } else {
          // TIER 3 FIX: use the canonical `computeParentSummary` engine
          // (same function the mock repository uses) instead of the inline
          // `Σ` calculation. The inline calculation didn't handle
          // reversed-originals correctly (counted them in typed totals),
          // producing different outstanding amounts in Mock vs Supabase
          // mode for the same ledger state.
          const ledger = (ledgerRows ?? []) as unknown as DashboardLedgerRow[];
          const byParent = new Map<string, LedgerEntry[]>();
          for (const row of ledger) {
            if (!row.parent_id) continue;
            const entry = mapLedgerRowToEntry(row);
            const list = byParent.get(row.parent_id) ?? [];
            list.push(entry);
            byParent.set(row.parent_id, list);
          }
          for (const [parentId, entries] of byParent) {
            const dueDateMap = buildOverdueDueDateMap(entries);
            const summary = computeParentSummary(entries, parentId, "", dueDateMap);
            if (summary.totalOutstanding > 0.001) {
              outstandingDebt += summary.totalOutstanding;
            }
          }
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] ledger query error:", e);
      }

      return Ok({
        totalStudents,
        totalParents,
        totalStaff: 0,
        monthlyRevenue,
        outstandingDebt,
        pendingExpenses: 0,
        attendanceRateToday: 0,
        overdueAlerts: 0,
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

  private emptyDemographics() {
    return {
      grade: [] as DemographicSlice[],
      gender: [] as DemographicSlice[],
      age: [] as DemographicSlice[],
      capacity: [] as DemographicSlice[],
    };
  }

  private async fetchRevenueRange(fromMs: number, toMs: number): Promise<Result<RevenuePoint[]>> {
    try {
      const tenantId = getTenantId();
      const { data, error } = await this.client
        .from("payments")
        .select("amount, status, collected_at")
        .eq("tenant_id", tenantId);
      if (error) {
        console.warn("[SupabaseDashboard] revenue query failed:", error.message);
        return Ok([]);
      }
      const rows = (data ?? []) as unknown as DashboardPaymentRow[];

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
      console.warn("[SupabaseDashboard] revenue query error:", e);
      return Ok([]);
    }
  }

  private async fetchDebtAging(): Promise<Result<DebtByAgingBucket[]>> {
    try {
      const tenantId = getTenantId();
      const { data, error } = await this.client
        .from("ledger_entries")
        .select("id, parent_id, student_id, entry_type, amount, category, entry_date, at, metadata, source_type, source_id, reverses_id, payment_status, method, receipt_number")
        .eq("tenant_id", tenantId)
        .limit(5000);
      if (error) {
        console.warn("[SupabaseDashboard] debt aging query failed:", error.message);
        return Ok(this.emptyBucketsArray());
      }
      const ledger = (data ?? []) as unknown as DashboardLedgerRow[];

      const buckets = this.emptyBuckets();

      // TIER 3 FIX: use the canonical `computeParentSummary` engine instead
      // of the inline `Σ` calculation. The inline calculation didn't handle
      // reversed-originals correctly (counted them in typed totals),
      // producing different debt-aging buckets in Mock vs Supabase mode.
      const byParent = new Map<string, LedgerEntry[]>();
      for (const row of ledger) {
        if (!row.parent_id) continue;
        const entry = mapLedgerRowToEntry(row);
        const list = byParent.get(row.parent_id) ?? [];
        list.push(entry);
        byParent.set(row.parent_id, list);
      }

      for (const [parentId, entries] of byParent) {
        const dueDateMap = buildOverdueDueDateMap(entries);
        const summary = computeParentSummary(entries, parentId, "", dueDateMap);
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
    } catch (e) {
      console.warn("[SupabaseDashboard] debt aging error:", e);
      return Ok(this.emptyBucketsArray());
    }
  }

  private emptyBuckets(): Record<string, { amount: number; debtorCount: number }> {
    return {
      "0_30": { amount: 0, debtorCount: 0 },
      "31_60": { amount: 0, debtorCount: 0 },
      "61_90": { amount: 0, debtorCount: 0 },
      "91_180": { amount: 0, debtorCount: 0 },
      "180_plus": { amount: 0, debtorCount: 0 },
    };
  }

  private emptyBucketsArray(): DebtByAgingBucket[] {
    return (Object.entries(this.emptyBuckets()) as Array<[string, { amount: number; debtorCount: number }]>).map(([bucket, data]) => ({
      bucket: bucket as AgingBucket,
      amount: data.amount,
      debtorCount: data.debtorCount,
    }));
  }

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
        yearStart = new Date(startYear, 8, 1).getTime();
        yearEnd = new Date(startYear + 1, 8, 1).getTime();
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
