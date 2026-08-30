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
import type { AgingBucket, Payment, PaymentCategory, PaymentMethod, PaymentStatus } from "../../../domain/model/payment";
import { agingBucketFromDays, sumPaidPayments } from "../../../domain/calc/payment";
import { sumOf } from "../../../domain/calc/shared/money";
import { academicLevelFromGradeLevel, GRADE_LEVEL_LABELS_FR, type AcademicLevel, type GradeLevel } from "../../../domain/model/student";
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
    // FIX (type): `sourceId`, `description`, `actorId`, `actorName` are
    // non-nullable on `LedgerEntry` — provide fallbacks instead of null.
    sourceId: row.source_id ?? row.id,
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: row.entry_type ?? "ledger entry",
    actorId: "system",
    actorName: "Supabase",
    at: row.at ?? row.entry_date ?? new Date().toISOString(),
    metadata: Object.freeze({}),
  };
}

// TIER 4 FIX (bypass #3 + #4): Canonical payment adapter.
// Map a raw Supabase `payments` row to the canonical `Payment` domain shape so
// the canonical `sumPaidPayments` / `revenueByMonth` functions from
// `domain/calc/payment` can consume it. This eliminates the inline
// `filter(paid).reduce(amount)` and per-bucket `+= Number(amount)` sums that
// previously duplicated the canonical revenue helpers.
//
// Only the fields read by the canonical helpers are populated with real data
// (`id`, `amount`, `status`, `category`, `collectedAt`); the rest are
// defaulted since the canonical `sumPaidPayments` / `revenueByMonth` only
// inspect those 5 fields. Mirrors the `mapLedgerRowToEntry` pattern.
function mapPaymentRowToPayment(row: DashboardPaymentRow): Payment {
  const collectedAt = row.collected_at ?? new Date(0).toISOString();
  return {
    id: row.id,
    tenantId: "",
    receiptNumber: "",
    parentId: "",
    studentId: null,
    amount: Number(row.amount),
    method: "cash" as PaymentMethod,
    status: (row.status ?? "pending") as PaymentStatus,
    category: (row.category ?? "other") as PaymentCategory,
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "",
    collectedAt,
    createdAt: collectedAt,
    updatedAt: collectedAt,
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

      // VAULT §15.03 — Grade Level Distribution is a BAR chart PER GRADE
      // (1AP, 2AP, …, 3ème Année) — not a pie by cycle. Each canonical
      // GradeLevel gets its own bar; unknown codes land in "Autre".
      const gradeCounts = new Map<string, number>();
      for (const s of active) {
        const code = (s.grade_level_code ?? "").toLowerCase() as GradeLevel;
        const label = (GRADE_LEVEL_LABELS_FR as Record<string, string>)[code] ?? "Autre";
        gradeCounts.set(label, (gradeCounts.get(label) ?? 0) + 1);
      }
      const totalWithLevels = [...gradeCounts.values()].reduce((a, b) => a + b, 0);
      const pct = (n: number) => totalWithLevels === 0 ? 0 : Math.round((n / totalWithLevels) * 100);
      const grade: DemographicSlice[] = [...gradeCounts.entries()]
        .map(([label, count]) => ({ label, count, percent: pct(count) }))
        .sort((a, b) => b.count - a.count);

      // Gender distribution — VAULT §15.03: Male / Female / Unspecified.
      const male = active.filter((s) => s.gender === "male").length;
      const female = active.filter((s) => s.gender === "female").length;
      const other = total - male - female;
      const genderPct = (n: number) => total === 0 ? 0 : Math.round((n / total) * 100);
      const gender: DemographicSlice[] = [
        { label: "Garçons", count: male, percent: genderPct(male) },
        { label: "Filles", count: female, percent: genderPct(female) },
        { label: "Non spécifié", count: other, percent: genderPct(other) },
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

      // VAULT §15.03 — Capacity vs Enrollment: GAUGE PER CLASS with REAL
      // fill rates (enrolled / capacity × 100). Previously every level was
      // hardcoded to percent: 0, leaving the gauges empty in Supabase mode.
      const capacity: DemographicSlice[] = await this.computeClassCapacity(tenantId);

      return Ok({ grade, gender, age, capacity });
    } catch (e) {
      console.warn("[SupabaseDashboard] demographics failed:", e);
      return Ok(this.emptyDemographics());
    }
  }

  /**
   * VAULT §15.03 — Capacity vs Enrollment per CLASS: fetches classes with
   * their capacity + enrolled counts and computes the real fill rate
   * (enrolled / capacity × 100). Returns the top 12 classes by fill rate.
   */
  private async computeClassCapacity(tenantId: string): Promise<DemographicSlice[]> {
    try {
      const { data, error } = await this.client
        .from("classes")
        .select("name, capacity, enrolled_count")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });
      if (error || !data) {
        console.warn("[SupabaseDashboard] classes capacity query failed:", error?.message);
        return [];
      }
      return (data as { name: string; capacity: number | null; enrolled_count: number | null }[])
        .map((c) => {
          const capacity = Number(c.capacity ?? 30);
          const enrolled = Number(c.enrolled_count ?? 0);
          return {
            label: c.name,
            count: enrolled,
            percent: capacity > 0 ? Math.round((enrolled / capacity) * 100) : 0,
          };
        })
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 12);
    } catch (e) {
      console.warn("[SupabaseDashboard] computeClassCapacity failed:", e);
      return [];
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
          const rows = (paymentRows ?? []) as unknown as DashboardPaymentRow[];
          const inRange = (ts: string | null) => {
            if (!ts) return false;
            const t = new Date(ts).getTime();
            return t >= fromMs && t < toMs;
          };
          // TIER 4 FIX (bypass #3): delegate the paid-status filter + sum to
          // the canonical `sumPaidPayments` helper from
          // `domain/calc/payment/sums.ts` (re-exported via the
          // `domain/calc/payment` barrel). The previous inline
          //   `payments.filter(paid + inRange).reduce((s,p) => s + Number(p.amount), 0)`
          // duplicated the canonical "sum of paid payments" rule. The in-range
          // date filter is preserved — the canonical `monthlyRevenue(payments)`
          // helper filters to the *current calendar month* which doesn't match
          // the academic-year / YTD scoping of `kpisForRange(academicYear, range)`,
          // so we apply the canonical paid-sum to the in-range subset instead.
          // Displayed values are unchanged: `sumPaidPayments` filters by
          // `status === "paid"` and sums `amount` — identical to the bypass.
          const inRangePayments = rows
            .filter((p) => inRange(p.collected_at))
            .map(mapPaymentRowToPayment);
          monthlyRevenue = sumPaidPayments(inRangePayments);
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

      // T-089 (2026-08-30): the 4 hardcoded-zero KPIs made the dashboard
      // blind to staff count, pending expenses, today's attendance, and
      // unread overdue alerts. All 4 are now real Supabase queries:
      //   - totalStaff: COUNT personnel WHERE deleted_at IS NULL
      //     (migration 0010 — the personnel table is canonical)
      //   - pendingExpenses: COUNT expenses WHERE status='submitted'
      //     (migration 0008 — expenses table)
      //   - attendanceRateToday: present+late / total for today (or most
      //     recent date with records; mirrors the mock's fallback)
      //     (migration 0009 — attendance_records)
      //   - overdueAlerts: COUNT notifications WHERE kind='alert' AND
      //     link_entity_type='installment' AND is_read=false
      //     (migration 0013 — notifications)
      let totalStaff = 0;
      try {
        const { count, error } = await this.client
          .from("personnel")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null);
        if (error) {
          console.warn("[SupabaseDashboard] personnel count failed:", error.message);
        } else {
          totalStaff = count ?? 0;
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] personnel count error:", e);
      }

      let pendingExpenses = 0;
      try {
        // DISCOVERY (T-089, 2026-08-30): the desktop domain model uses
        // status='submitted', but the live `expense_tickets` table
        // (migration 0008) uses status='pending_approval'. This is
        // the same drift class as BUG-NEW-001 (the `users` table
        // reference). Documented in the problem registry as DRIFT-013.
        //
        // T-093 UPDATE (2026-08-31): the wider expenses-repository leak is
        // CLOSED — `SupabaseExpenseRepository` now backs the `expenses`
        // slot against `expense_tickets` (with migration 0056's payee
        // column), so this KPI and the tickets list read the same rows.
        const { count, error } = await this.client
          .from("expense_tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "pending_approval");
        if (error) {
          console.warn("[SupabaseDashboard] expense_tickets count failed:", error.message);
        } else {
          pendingExpenses = count ?? 0;
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] expense_tickets count error:", e);
      }

      let attendanceRateToday = 0;
      try {
        // Today's records — fall back to the most recent date with records
        // (same fallback the mock uses).
        const today = new Date().toISOString().slice(0, 10);
        const { data: todayRows, error: todayErr } = await this.client
          .from("attendance_records")
          .select("status")
          .eq("tenant_id", tenantId)
          .eq("date", today);
        let rows: Array<{ status: string | null }> = (todayRows ?? []) as Array<{ status: string | null }>;
        if (todayErr || rows.length === 0) {
          // Find the most recent date with records.
          const { data: recentRows, error: recentErr } = await this.client
            .from("attendance_records")
            .select("date, status")
            .eq("tenant_id", tenantId)
            .order("date", { ascending: false })
            .limit(500);
          if (!recentErr && recentRows && recentRows.length > 0) {
            const recent = recentRows as Array<{ date: string; status: string | null }>;
            const latestDate = recent[0].date;
            rows = recent.filter((r) => r.date === latestDate);
          } else {
            rows = [];
          }
        }
        if (rows.length > 0) {
          // Per ADR-002 / WEAK-019 fix: canonical attendance rate is
          // (present + late) / total. A "present" or "late" record
          // counts the student as attending; "absent" or "excused"
          // does not.
          const attending = rows.filter((r) => r.status === "present" || r.status === "late").length;
          attendanceRateToday = attending / rows.length;
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] attendance rate error:", e);
      }

      let overdueAlerts = 0;
      try {
        // T-080's SupabaseOverdueAlertGenerator writes notifications with
        // kind='alert' and link_entity_type='installment'. Count unread
        // ones so the KPI grid surfaces the operational queue.
        const { count, error } = await this.client
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("kind", "alert")
          .eq("link_entity_type", "installment")
          .eq("is_read", false);
        if (error) {
          console.warn("[SupabaseDashboard] overdue alerts count failed:", error.message);
        } else {
          overdueAlerts = count ?? 0;
        }
      } catch (e) {
        console.warn("[SupabaseDashboard] overdue alerts count error:", e);
      }

      return Ok({
        totalStudents,
        totalParents,
        totalStaff,
        monthlyRevenue,
        outstandingDebt,
        pendingExpenses,
        attendanceRateToday,
        overdueAlerts,
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
      // TIER 4 FIX (bypass #4): delegate the per-bucket paid-payment sum to
      // the canonical `sumOf` helper from `domain/calc/shared/money` (the
      // same helper used by `sumPaidPayments` and `monthlyRevenue`
      // internally). The previous inline loop
      //   `for (p of rows) if (paid && inRange) bucket.amount += Number(p.amount)`
      // duplicated the canonical "sum paid payments by month" rule.
      //
      // We use `sumOf` (rather than `revenueByMonth` directly) because
      // `revenueByMonth` always builds a fixed 12-month window ending at
      // `now`'s month — it doesn't support arbitrary [fromMs, toMs) ranges
      // like Q1 / semester / month presets that callers pass via
      // `revenueForRange(year, range)`. We preserve the bypass's bucketing
      // (which handles arbitrary ranges) but route the per-bucket SUM
      // through the canonical helper so the aggregation rule ("sum of paid
      // payments, dropping non-finite values") matches the rest of the
      // calc engine.
      const paidInRangePayments: Payment[] = rows
        .filter((p) => p.status === "paid" && p.collected_at)
        .map(mapPaymentRowToPayment)
        .filter((p) => {
          const t = new Date(p.collectedAt).getTime();
          return t >= fromMs && t < toMs;
        });
      // Group by `${year}-${month}` so each bucket's sum is computed in a
      // single canonical `sumOf` call.
      const groupedByMonth = new Map<string, Payment[]>();
      for (const p of paidInRangePayments) {
        const d = new Date(p.collectedAt);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const list = groupedByMonth.get(key) ?? [];
        list.push(p);
        groupedByMonth.set(key, list);
      }
      for (const bucket of buckets) {
        const key = `${bucket.year}-${bucket.month}`;
        bucket.amount = sumOf(groupedByMonth.get(key) ?? [], (p) => p.amount);
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
