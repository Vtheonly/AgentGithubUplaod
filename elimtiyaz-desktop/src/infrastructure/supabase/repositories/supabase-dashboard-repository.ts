/**
 * SupabaseDashboardRepository — live metrics, revenue charts, debt aging & demographics.
 *
 * Implements DashboardRepository backed by Supabase tables:
 *   - students
 *   - parents
 *   - personnel
 *   - payments
 *   - installments
 *   - expense_tickets
 *   - attendance_records
 *   - classes
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { Ok, Err, type Result } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type { DashboardRepository, DateRange } from "../../../domain/repository/repository";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
  DemographicSlice,
} from "../../../domain/model/operations";
import type { AgingBucket, Installment, Payment } from "../../../domain/model/payment";
import { buildWindowAnchoredBuckets, daysBetweenFloor, isStrictlyPast, MONTH_LABELS_FR } from "../../../domain/calc/shared/dates";
import { agingBucketFromDays, isInstallmentOverdue } from "../../../domain/calc/payment/queries";
import {
  callCollectionRpc,
  paginateKeyset,
  readWithSeedRetry,
  mapPaymentRow,
  mapInstallmentRow,
  isRpcUnavailableError,
} from "./supabase-shared-repositories";
import type { PaymentRow, InstallmentRow } from "../types";
import { GRADE_LEVEL_LABELS_FR, IMPORTED_BIRTH_DATE_PLACEHOLDER, type GradeLevel } from "../../../domain/model/student";
import { currentAcademicYear } from "../../../core/format/date";

// ============================================================================
// T-590 (E7A-1 / ROADMAP 6.3) — the compact-RPC dashboard data path
// ============================================================================

/**
 * T-590: the feature flag for the compact-RPC dashboard data path. Default
 * ON — the aggregation RPCs (migration 0002) are the egress-minimal shape;
 * `localStorage["el-imtiyaz.flags.dashboardRpc"] = "0"` forces the legacy
 * client-side collection path (the documented fallback — the version-skew
 * wire falls back automatically when the RPC is absent on the target DB).
 */
const DASHBOARD_RPC_FLAG_KEY = "el-imtiyaz.flags.dashboardRpc";
function dashboardRpcPathEnabled(): boolean {
  try {
    return localStorage.getItem(DASHBOARD_RPC_FLAG_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The compact KPI row shape `read_dashboard_kpis` returns (camelCase keys). */
interface KpiRpcRow {
  totalStudents: number | string;
  totalParents: number | string;
  totalStaff: number | string;
  monthlyRevenue: number | string;
  outstandingDebt: number | string;
  overdueAlerts: number | string;
  overdueAmount: number | string;
  pendingExpenses: number | string;
  attendancePresent: number | string;
  attendanceTotal: number | string;
}

/** The month-bucket row `read_dashboard_revenue_by_month` returns. */
interface RevenueMonthRpcRow {
  year: number | string;
  month: number | string;
  amount: number | string;
}

/** The aging-bucket row `read_dashboard_debt_aging` returns. */
interface AgingRpcRow {
  bucket: string;
  amount: number | string;
  debtorCount: number | string;
}

/** The compact demographics census `read_dashboard_demographics` returns. */
interface DemographicsCensusRow {
  classes: Array<{ class_id: string; class_name: string | null; grade_code: string | null; student_count: number | string }> | null;
  unassignedByLevel: Array<{ grade_level_code: string; count: number | string }> | null;
  unassignedUnknown: number | string;
  gender: { male: number | string; female: number | string; unspecified: number | string } | null;
  ageBuckets: Array<{ min: number; max: number; count: number | string }> | null;
  unknownBirthDate: number | string;
}

export class SupabaseDashboardRepository implements DashboardRepository {
  constructor(private readonly client: SupabaseClient) {}

  private getTenantId(): string {
    try {
      const raw = localStorage.getItem("el-imtiyaz.session");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.tenantId) return s.tenantId;
      }
    } catch {
      /* ignore */
    }
    return "00000000-0000-0000-0000-000000000001";
  }

  /**
   * T-353 (DASH-403): the billing window of an academic year —
   * [Sept 1 of the start year, Sept 1 of the next). Null when the code
   * doesn't parse (no scoping possible). The `installments` table has NO
   * academic_year column; `due_date` is the only year signal, so the
   * debt-scoped aggregates (KPI outstanding + aging) follow THIS window.
   * Mirrors the mock's documented semantics ("the academic year
   * determines which installments to consider").
   */
  // DUP-007 (T-411, FA-15d) → E2.5 (DUP-019): the current school year is
  // the CORE helper (core/format/date.ts currentAcademicYear — September
  // rollover), no private clone.

  private academicYearWindow(academicYear: string): { from: string; to: string } | null {
    const m = /^(\d{4})-(\d{4})$/.exec(academicYear);
    if (!m) return null;
    const start = parseInt(m[1], 10);
    return { from: `${start}-09-01`, to: `${start + 1}-09-01` };
  }

  async kpis(): Promise<Result<DashboardKpi>> {
    return this.kpisForRange(currentAcademicYear());
  }

  async kpisForRange(academicYear: string, range?: DateRange): Promise<Result<DashboardKpi>> {
    const tenantId = this.getTenantId();

    try {
      // T-590 (E7A-1): the compact-RPC data path — ONE jsonb round trip
      // (migration 0002's read_dashboard_kpis) instead of the full-collection
      // reads below. Version skew (the RPC absent on the target DB) or the
      // feature flag falls through to the legacy client-side path; a
      // transient RPC failure rides the SAME retry ladder (readWithSeedRetry,
      // the T-504 doctrine) and surfaces the SAME honest-Err (the "—"
      // placeholders, never fabricated zeroes).
      if (dashboardRpcPathEnabled()) {
        const outcome = await readWithSeedRetry(() =>
          this.callAggregateRpc<KpiRpcRow>("read_dashboard_kpis", {
            p_academic_year: academicYear,
            p_from: range?.from ? range.from.slice(0, 10) : null,
            p_to: range?.to ? range.to.slice(0, 10) : null,
            p_as_of: new Date().toISOString().slice(0, 10),
          }),
        );
        if (outcome.ok && outcome.rows) {
          return Ok(this.mapKpiRpcRow(outcome.rows));
        }
        if (!outcome.ok) {
          console.warn("[SupabaseDashboard] kpisForRange RPC failed (honest Err):", outcome.error);
          return Err(Errors.unknown(outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error))));
        }
        // outcome.ok && !rows → version skew → the legacy path below.
      }
      const now = new Date();
      // TIME-001 (T-426 Phase C, issue #24 Track 1 item 3): the KPI's
      // month window is constructed at UTC MIDNIGHT — the SAME convention
      // `revenueForRange` + `buildWindowAnchoredBuckets` apply (their
      // `T00:00:00Z` strings / setUTC* cursor). The previous local-time
      // constructors (`new Date(y, m, 1)` → `.toISOString()`) shifted each
      // boundary by the timezone offset in the OTHER direction on each
      // side (UTC+1: start 23:00 of the previous day), so a payment in
      // the boundary hour could appear in the KPI's month while the chart
      // placed it in the neighbouring month — the month-border revenue
      // discrepancy the audit reported.
      const monthStart =
        range?.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const monthEnd =
        range?.to ??
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
      const todayStr = now.toISOString().slice(0, 10);

      // We omit the failing notifications query and derive overdue alerts from installments.
      // T-424 (DATA-043): the payments + installments reads go through the
      // RPC collections (full sets — the old single reads were capped at
      // 1,000 rows: 2,198 paid payments / 4,227 unpaid installments live).
      const [
        studentsRes,
        parentsRes,
        staffRes,
        paidPayments,
        unpaidInstallments,
        expensesRes,
        attendanceRes,
      ] = await Promise.all([
        // DATA-047 (T-426 Phase D, issue #24 Track 1 item 1): the count
        // queries follow the CANONICAL liveness marker `deleted_at IS
        // NULL` — the same convention the debt-replay path
        // (financial-realtime.ts) applies. The previous
        // `.eq("is_active", true)` agreed with it on live data (verified
        // read-only: all 1,137 alive students / 741 parents / 8 personnel
        // carry is_active = true; 0 NULL) but would silently drop any
        // future row imported with `is_active IS NULL` — the exact
        // "ÉLÈVES : 0" failure mode the audit reported (whose live
        // mechanism is the silent-zero catch, fixed below).
        this.client
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null),
        this.client
          .from("parents")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null),
        this.client
          .from("personnel")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null),
        this.readPaidPaymentsCollection(tenantId),
        this.readUnpaidInstallmentsForYear(tenantId, academicYear),
        this.client
          .from("expense_tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("status", ["draft", "pending_approval", "submitted"]),
        this.client
          .from("attendance_records")
          .select("status")
          .eq("tenant_id", tenantId)
          .eq("date", todayStr),
      ]);

      const monthlyRevenue = paidPayments
        .filter((p) => p.collected_at >= monthStart && p.collected_at < monthEnd)
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      const allInstallments = unpaidInstallments;
      const outstandingDebt = allInstallments.reduce((sum, i) => {
        const due = Number(i.amount_due) || 0;
        const paid = Number(i.amount_paid) || 0;
        const pending = Number(i.amount_pending) || 0;
        return sum + Math.max(0, due - paid - pending);
      }, 0);

      // Overdue alerts computed directly from installments (100% reliable)
      // T-426 (DATA-045): DYNAMIC — the canonical temporal predicate, never
      // the `status === "overdue"` string (live: ZERO rows carry that
      // status while 874 rows are dynamically overdue). Same for the new
      // dedicated `overdueAmount` metric (the DZD actually past due —
      // future T2/T3 tranches are "à échoir", never "en retard").
      const asOverdueInput = (i: {
        status: string | null;
        amount_due: number | string | null;
        amount_paid: number | string | null;
        amount_pending: number | string | null;
        due_date: string;
      }) => ({
        status: i.status,
        amountDue: Number(i.amount_due) || 0,
        amountPaid: Number(i.amount_paid) || 0,
        amountPending: Number(i.amount_pending) || 0,
        dueDate: i.due_date,
      });
      const overdueAlerts = allInstallments.filter((i) =>
        isInstallmentOverdue(asOverdueInput(i), now),
      ).length;
      const overdueAmount = allInstallments.reduce((sum, i) => {
        const input = asOverdueInput(i);
        if (!isInstallmentOverdue(input, now)) return sum;
        return sum + Math.max(0, input.amountDue - input.amountPaid - input.amountPending);
      }, 0);

      const attendanceRecords = attendanceRes.data ?? [];
      let attendanceRateToday = 1.0;
      if (attendanceRecords.length > 0) {
        const presentCount = attendanceRecords.filter(
          (r) => r.status === "present" || r.status === "late",
        ).length;
        attendanceRateToday = Number((presentCount / attendanceRecords.length).toFixed(2));
      }

      return Ok({
        totalStudents: studentsRes.count ?? 0,
        totalParents: parentsRes.count ?? 0,
        totalStaff: staffRes.count ?? 0,
        monthlyRevenue,
        outstandingDebt,
        overdueAmount,
        pendingExpenses: expensesRes.count ?? 0,
        attendanceRateToday,
        overdueAlerts,
      });
    } catch (err) {
      // DATA-047 (T-426 Phase D): the CACHE-103-class silent-zero fallback
      // is GONE — a failed KPI read now returns Err and the Overview cards
      // render their honest "—" placeholders (the consumer maps
      // `k.ok ? k.value : null`). The previous `Ok({ …zeroes… })` rendered
      // confident "ÉLÈVES : 0 / 0 DZD" on every read failure — the
      // read-path failure mode behind the audit's "ÉLÈVES : 0" report
      // (the live DB itself never had a count problem: the census
      // verified 1,137/741/8 alive rows).
      console.warn("[SupabaseDashboard] kpisForRange error (honest Err, no fabricated zeroes):", err);
      return Err(Errors.unknown(err instanceof Error ? err : new Error(String(err))));
    }
  }

  /**
   * T-424 (DATA-043): the installments collection — RPC FIRST
   * (`read_installments_collection`, migration 0123: one immune jsonb
   * round trip — SECURITY DEFINER, no per-row RLS policy chain, no
   * 1,000-row cap) with the direct KEYSET read as the version-skew
   * fallback (§15.62c). The previous single unpaginated read was capped
   * at 1,000 rows — with 4,227 unpaid installments live, the KPI
   * `outstandingDebt` and the aging chart computed over a biased 24%
   * sample while the Finances page (the RPC-seeded caches) showed the
   * full collections — the Statistics-vs-Finance gap this task closes.
   */
  private async readInstallmentsCollection(tenantId: string): Promise<
    Array<Pick<InstallmentRow, "id" | "parent_id" | "amount_due" | "amount_paid" | "amount_pending" | "due_date" | "status">>
  > {
    // T-504 (PERF-510, the 2026-10-12 recurrence): the WHOLE read (the RPC
    // first, the keyset fallback) is ONE retry unit. The owner's console
    // showed the exact prior failure shape: a transient 500 on
    // `read_installments_collection` failed the WHOLE kpisForRange /
    // debtByAgingForRange honest-Err — the callCollectionRpc contract
    // ("the seed's retry ladder handles transient failures") finally
    // true HERE too. A FINAL failure still THROWS (the honest-Err contract
    // upstream is unchanged — the KPI cards render their "—" placeholders,
    // never fabricated zeroes).
    const outcome = await readWithSeedRetry(async () => {
      const rpcRows = await callCollectionRpc<
        Pick<InstallmentRow, "id" | "parent_id" | "amount_due" | "amount_paid" | "amount_pending" | "due_date" | "status">
      >(this.client, "read_installments_collection");
      if (rpcRows) return rpcRows;
      return paginateKeyset(async (lastId) => {
        const base = this.client
          .from("installments")
          .select("id, parent_id, amount_due, amount_paid, amount_pending, due_date, status")
          .eq("tenant_id", tenantId);
        const { data, error } = await (lastId ? base.gt("id", lastId) : base)
          .order("id", { ascending: true })
          .limit(1000);
        return { data: (data ?? []) as Array<Pick<InstallmentRow, "id" | "parent_id" | "amount_due" | "amount_paid" | "amount_pending" | "due_date" | "status">>, error: error as { message: string } | null };
      });
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.rows;
  }

  /**
   * T-424 (DATA-043): the payments collection — the same RPC-first shape
   * (`read_payments_collection`) for the revenue reads (the KPI's monthly
   * revenue and `revenueForRange` were equally capped at 1,000 of 2,198
   * paid payments live).
   */
  private async readPaidPaymentsCollection(tenantId: string): Promise<
    Array<Pick<PaymentRow, "id" | "amount" | "collected_at" | "status">>
  > {
    // T-504 (PERF-510): the same retried unit as readInstallmentsCollection
    // (the revenue reads ride the same ladder; a transient 500 retries the
    // whole read, a final failure throws → the honest-Err upstream).
    const outcome = await readWithSeedRetry(async () => {
      const rpcRows = await callCollectionRpc<
        Pick<PaymentRow, "id" | "amount" | "collected_at" | "status">
      >(this.client, "read_payments_collection");
      if (rpcRows) {
        return rpcRows.filter((p) => p.status === "paid");
      }
      return paginateKeyset(async (lastId) => {
        const base = this.client
          .from("payments")
          .select("id, amount, collected_at, status")
          .eq("tenant_id", tenantId)
          .eq("status", "paid");
        const { data, error } = await (lastId ? base.gt("id", lastId) : base)
          .order("id", { ascending: true })
          .limit(1000);
        return { data: (data ?? []) as Array<Pick<PaymentRow, "id" | "amount" | "collected_at" | "status">>, error: error as { message: string } | null };
      });
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.rows;
  }

  /**
   * T-353 (DASH-403): the unpaid-installments view over the FULL
   * collection, scoped to the academic year's billing window (due_date)
   * when the year code parses. A shared derivation for kpisForRange +
   * debtByAgingForRange so the KPI outstanding and the aging chart follow
   * the SAME year semantics — now over every row, not a capped sample.
   */
  private async readUnpaidInstallmentsForYear(
    tenantId: string,
    academicYear: string,
  ): Promise<Array<Pick<InstallmentRow, "parent_id" | "amount_due" | "amount_paid" | "amount_pending" | "due_date" | "status">>> {
    const all = await this.readInstallmentsCollection(tenantId);
    const window = this.academicYearWindow(academicYear);
    return all.filter((i) => {
      if (i.status === "paid") return false;
      if (!window) return true;
      return i.due_date >= window.from && i.due_date < window.to;
    });
  }

  async revenueLast12Months(): Promise<Result<RevenuePoint[]>> {
    return this.revenueForRange(currentAcademicYear());
  }

  async revenueForRange(academicYear: string, range?: DateRange): Promise<Result<RevenuePoint[]>> {
    const tenantId = this.getTenantId();

    try {
      // T-356 (DASH-407): the bucket window is the REQUESTED range — or,
      // when absent, the academic year's billing window (the mock's
      // computeRange convention: the year resolves the window). The
      // previous implementation anchored buckets to the LAST 12 MONTHS
      // FROM NOW — labels that drift away from the selected academic
      // year and in-range payments silently dropped outside the
      // NOW-relative window (the §15.15 mock↔Supabase parity break).
      const window =
        range?.from && range?.to
          ? { from: range.from, to: range.to }
          : (this.academicYearWindow(academicYear) ?? undefined);

      // T-590 (E7A-1): the compact-RPC path — the window-anchored month
      // buckets (read_dashboard_revenue_by_month) in ONE round trip. The
      // labels map client-side (MONTH_LABELS_FR — the SAME engine the
      // legacy path's buildWindowAnchoredBuckets uses); an absent window
      // keeps the legacy "[]" contract on both paths.
      if (window && dashboardRpcPathEnabled()) {
        const outcome = await readWithSeedRetry(() =>
          this.callAggregateRpc<RevenueMonthRpcRow[]>("read_dashboard_revenue_by_month", {
            p_from: window.from.slice(0, 10),
            p_to: window.to.slice(0, 10),
          }),
        );
        if (outcome.ok && outcome.rows) {
          return Ok(
            outcome.rows.map((r) => ({
              label: MONTH_LABELS_FR[Number(r.month)] ?? String(r.month),
              amount: Number(r.amount) || 0,
            })),
          );
        }
        if (!outcome.ok) {
          console.warn("[SupabaseDashboard] revenueForRange RPC failed — degrading to [] (the legacy path's contract):", outcome.error);
          return Ok([]);
        }
        // version skew → the legacy path below.
      }
      if (!window) {
        return Ok([]);
      }

      // T-424 (DATA-043): the RPC payments collection (every paid row —
      // the old single read was capped at 1,000 of 2,198 live), filtered
      // client-side with the SAME window semantics.
      const paid = await this.readPaidPaymentsCollection(tenantId);
      let rows = paid.map((p) => ({
        amount: p.amount as number | string,
        collectedAt: p.collected_at as string,
      }));
      if (window) {
        // EXCLUSIVE upper bound at the to-date's midnight — the house
        // convention (the mock's computeRange `t < toMs` AND the KPI's
        // `.lt(collected_at, monthEnd)`): the boundary day belongs to the
        // NEXT window, never double-counted.
        const from = `${window.from.slice(0, 10)}T00:00:00Z`;
        const to = `${window.to.slice(0, 10)}T00:00:00Z`;
        rows = rows.filter((p) => p.collectedAt >= from && p.collectedAt < to);
      }
      const buckets = buildWindowAnchoredBuckets(window, rows);

      return Ok(buckets.map((b) => ({ label: b.label, amount: b.amount })));
    } catch (err) {
      console.warn("[SupabaseDashboard] revenue exception:", err);
      return Ok([]);
    }
  }

  async debtByAging(): Promise<Result<DebtByAgingBucket[]>> {
    return this.debtByAgingForRange(currentAcademicYear());
  }

  async debtByAgingForRange(academicYear: string, range?: DateRange): Promise<Result<DebtByAgingBucket[]>> {
    const tenantId = this.getTenantId();

    const bucketKeys: AgingBucket[] = ["0_30", "31_60", "61_90", "91_180", "180_plus"];

    // T-590 (E7A-1): the compact-RPC path — the per-installment aging
    // aggregation (read_dashboard_debt_aging) in ONE round trip. Only
    // past-due rows with a REAL remaining balance age (DATA-046 — the
    // RPC's WHERE clause is the SQL twin of isStrictlyPast + the INV-4
    // remaining predicate); every bucket row renders, missing buckets as
    // honest zeros (the legacy shape).
    if (dashboardRpcPathEnabled()) {
      const outcome = await readWithSeedRetry(() =>
        this.callAggregateRpc<AgingRpcRow[]>("read_dashboard_debt_aging", {
          p_academic_year: academicYear,
          p_as_of: new Date().toISOString().slice(0, 10),
        }),
      );
      if (outcome.ok && outcome.rows) {
        const byBucket = new Map(outcome.rows.map((r) => [String(r.bucket), r]));
        return Ok(
          bucketKeys.map((k) => {
            const row = byBucket.get(k);
            return {
              bucket: k,
              amount: Number(row?.amount) || 0,
              debtorCount: Number(row?.debtorCount) || 0,
            };
          }),
        );
      }
      if (!outcome.ok) {
        console.warn("[SupabaseDashboard] debt aging RPC failed (honest Err, no fabricated buckets):", outcome.error);
        return Err(Errors.unknown(outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error))));
      }
      // version skew → the legacy path below.
    }

    const bucketTotals = new Map<AgingBucket, { amount: number; parents: Set<string> }>();
    for (const k of bucketKeys) {
      bucketTotals.set(k, { amount: 0, parents: new Set<string>() });
    }

    try {
      const now = new Date();
      // T-353 (DASH-403): the aging chart follows the academic year's
      // billing window (same readUnpaidInstallmentsForYear as the KPI's
      // outstanding — ONE year semantics for both debt aggregates).
      // T-424 (DATA-043): the RPC collection read — every unpaid row, not
      // a 1,000-row sample.
      const rows = await this.readUnpaidInstallmentsForYear(tenantId, academicYear);

      for (const row of rows) {
        const due = Number(row.amount_due) || 0;
        const paid = Number(row.amount_paid) || 0;
        const pending = Number(row.amount_pending) || 0;
        const remaining = Math.max(0, due - paid - pending);
        if (remaining <= 0) continue;

        // DATA-046 (T-426, GitHub issue #24's Track-2 aging finding): only
        // PAST-DUE rows age. `daysBetweenFloor` clamps a future due date to
        // 0 days — not negative — so a not-yet-due row (a future T2/T3
        // tranche) silently landed in the "0_30" bucket, inflating the
        // "current" receivable band (and the KPI's overdue-family count,
        // which sums the buckets' debtorCount) with balances that are not
        // late at all. A future row is "à échoir" (not yet due), never
        // aging — it is excluded from every bucket here.
        if (!isStrictlyPast(row.due_date, now)) continue;

        const daysOverdue = daysBetweenFloor(row.due_date, now);
        const bucket = agingBucketFromDays(daysOverdue);
        const entry = bucketTotals.get(bucket);
        if (entry) {
          entry.amount += remaining;
          if (row.parent_id) entry.parents.add(row.parent_id);
        }
      }

      return Ok(
        bucketKeys.map((k) => {
          const entry = bucketTotals.get(k)!;
          return {
            bucket: k,
            amount: entry.amount,
            debtorCount: entry.parents.size,
          };
        }),
      );
    } catch (err) {
      console.warn("[SupabaseDashboard] debt aging error (honest Err, no fabricated buckets):", err);
      return Err(Errors.unknown(err instanceof Error ? err : new Error(String(err))));
    }
  }

  async demographics(): Promise<
    Result<{
      grade: DemographicSlice[];
      gender: DemographicSlice[];
      age: DemographicSlice[];
    }>
  > {
    const tenantId = this.getTenantId();

    try {
      // T-590 (E7A-1): the compact-RPC path — the demographics census
      // (read_dashboard_demographics: per-class counts, unassigned-by-level,
      // gender, age buckets) in ONE round trip. The French label mapping
      // stays HERE (GRADE_LEVEL_LABELS_FR — the SAME mapping the legacy
      // loop applies), so the parity contract is the mapping + the census,
      // not a second engine.
      if (dashboardRpcPathEnabled()) {
        const outcome = await readWithSeedRetry(() =>
          this.callAggregateRpc<DemographicsCensusRow>("read_dashboard_demographics", {
            p_as_of: new Date().toISOString().slice(0, 10),
          }),
        );
        if (outcome.ok && outcome.rows) {
          return Ok(this.mapDemographicsCensus(outcome.rows));
        }
        if (!outcome.ok) {
          console.warn("[SupabaseDashboard] demographics RPC failed — degrading to empty slices (the legacy path's contract):", outcome.error);
          return Ok({ grade: [], gender: [], age: [] });
        }
        // version skew → the legacy path below.
      }
      // 1. Fetch only verified columns on students (no 'level' or 'grade_year').
      // T-339 (STATS-400): the classes query drops `capacity` — the fill-rate
      // slice was REMOVED (a class has no artificial maximum; the replacement
      // is the section-imbalance derivation, see executive-statistics.ts).
      // DATA-047 (T-426 Phase D, issue #24 Track 1 item 4): `grade_level_code`
      // joins the select so a student WITHOUT a class assignment still groups
      // under their ENROLLED grade level instead of the "Non assigné" bucket,
      // and the liveness filter follows the canonical `deleted_at IS NULL`
      // marker (same convention as the count queries above).
      const [studentsRes, classesRes] = await Promise.all([
        this.client
          .from("students")
          .select("id, gender, date_of_birth, class_id, grade_level_code")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null),
        this.client
          .from("classes")
          .select("id, name, grade_code")
          .eq("tenant_id", tenantId)
          .order("name", { ascending: true }),
      ]);

      const students = studentsRes.data ?? [];
      const totalStudents = students.length || 1;
      const classes = classesRes.data ?? [];

      const classMap = new Map<string, { name: string; grade_code: string | null }>();

      for (const c of classes) {
        classMap.set(c.id, {
          name: c.name ?? c.id,
          grade_code: c.grade_code ?? null,
        });
      }

      // 2. Grade distribution (derived safely from student's class)
      // DATA-047 (T-426 Phase D): the fallback chain is class grade_code →
      // the student's OWN enrolled `grade_level_code` → "Non assigné" —
      // an unassigned student (class_id NULL) groups by their enrolled
      // level, never a catch-all bucket, when the code carries a known
      // grade level.
      const gradeCounts = new Map<string, number>();
      for (const s of students) {
        const cls = s.class_id ? classMap.get(s.class_id) : null;
        let gradeKey = "Non assigné";
        if (cls) {
          if (cls.grade_code && cls.grade_code in GRADE_LEVEL_LABELS_FR) {
            gradeKey = GRADE_LEVEL_LABELS_FR[cls.grade_code as GradeLevel];
          } else {
            gradeKey = cls.name;
          }
        } else if (
          s.grade_level_code &&
          s.grade_level_code in GRADE_LEVEL_LABELS_FR
        ) {
          gradeKey = GRADE_LEVEL_LABELS_FR[s.grade_level_code as GradeLevel];
        }
        gradeCounts.set(gradeKey, (gradeCounts.get(gradeKey) ?? 0) + 1);
      }

      const grade: DemographicSlice[] = Array.from(gradeCounts.entries()).map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / totalStudents) * 100),
      }));

      // 3. Gender distribution
      let maleCount = 0;
      let femaleCount = 0;
      let unspecifiedCount = 0;

      for (const s of students) {
        if (s.gender === "male") maleCount++;
        else if (s.gender === "female") femaleCount++;
        else unspecifiedCount++;
      }

      const gender: DemographicSlice[] = [
        { label: "Garçons", count: maleCount, percent: Math.round((maleCount / totalStudents) * 100) },
        { label: "Filles", count: femaleCount, percent: Math.round((femaleCount / totalStudents) * 100) },
      ];
      if (unspecifiedCount > 0) {
        gender.push({
          label: "Non spécifié",
          count: unspecifiedCount,
          percent: Math.round((unspecifiedCount / totalStudents) * 100),
        });
      }

      // 4. Age distribution — T-357 (DATA-018): NULL and the documented
      // import placeholder (2000-01-01 — the workbook has NO birth-date
      // column) are "Non renseigné", NEVER computed ages. The previous
      // derivation turned every imported child into a 26-year-old
      // ("18+ ans: 391" on live) — placeholder data presented as
      // demographic intelligence. Real birth dates bucket normally.
      const ageBuckets = [
        { label: "< 6 ans", min: 0, max: 5, count: 0 },
        { label: "6–8 ans", min: 6, max: 8, count: 0 },
        { label: "9–11 ans", min: 9, max: 11, count: 0 },
        { label: "12–14 ans", min: 12, max: 14, count: 0 },
        { label: "15–17 ans", min: 15, max: 17, count: 0 },
        { label: "18+ ans", min: 18, max: 120, count: 0 },
      ];
      let unknownBirthDate = 0;

      const currentYear = new Date().getFullYear();
      for (const s of students) {
        const raw = s.date_of_birth ? String(s.date_of_birth).slice(0, 10) : null;
        if (!raw || raw === IMPORTED_BIRTH_DATE_PLACEHOLDER) {
          unknownBirthDate += 1;
          continue;
        }
        const birthYear = new Date(raw).getFullYear();
        if (isNaN(birthYear)) {
          unknownBirthDate += 1;
          continue;
        }
        const ageYears = currentYear - birthYear;
        const bucket = ageBuckets.find((b) => ageYears >= b.min && ageYears <= b.max);
        if (bucket) bucket.count++;
      }

      const age: DemographicSlice[] = ageBuckets.map((b) => ({
        label: b.label,
        count: b.count,
        percent: Math.round((b.count / totalStudents) * 100),
      }));
      if (unknownBirthDate > 0) {
        age.push({
          label: "Non renseigné",
          count: unknownBirthDate,
          percent: Math.round((unknownBirthDate / totalStudents) * 100),
        });
      }

      // 5. T-339 (STATS-400): the CAPACITY fill-rate distribution was
      // REMOVED — no fake ceilings. The section-imbalance intelligence now
      // lives in the executive statistics (deriveEnrollmentDynamics), which
      // consumes the classes stream directly.

      return Ok({
        grade,
        gender,
        age,
      });
    } catch (err) {
      console.warn("[SupabaseDashboard] demographics exception:", err);
      return Ok({
        grade: [],
        gender: [],
        age: [],
      });
    }
  }

  // ==========================================================================
  // T-590 (E7A-1) — the bounded row-level reads (the dashboard page's
  // entity data): the full-tenant observable subscriptions DIE; the page
  // fetches the range-bounded / year-bounded sets through these instead.
  // ==========================================================================

  /**
   * T-590: the payments inside [range.from, range.to) — the dashboard's
   * tab-level entity data (the analytics filters / the weekly rhythm / the
   * see-details modal all consume the RANGE-bounded slice). A bounded
   * keyset walk (server-side window filters + the id-cursor pages + the
   * mapPaymentRow column projection) — never a full-tenant download.
   */
  async paymentsForRange(range: DateRange): Promise<Result<Payment[]>> {
    const tenantId = this.getTenantId();
    if (!range?.from || !range?.to) {
      return Err(Errors.validation("paymentsForRange: a bounded from/to range is required"));
    }
    // The house window convention: UTC midnight bounds, exclusive end —
    // the SAME bounds `applyAnalyticsFilters`/`inRange` apply client-side.
    const fromTs = `${range.from.slice(0, 10)}T00:00:00Z`;
    const toTs = `${range.to.slice(0, 10)}T00:00:00Z`;
    const outcome = await readWithSeedRetry(async () => {
      const rows = await paginateKeyset(async (lastId) => {
        const base = this.client
          .from("payments")
          .select(
            "id, tenant_id, parent_id, student_id, amount, method, category, status, collected_at, collected_by, created_at, updated_at, receipt_number, payment_number, installment_id, proof_path, notes, check_number, check_bank_name, check_issue_date, check_clearance_date, transfer_reference, transfer_source_bank, expected_amount, excess_amount, excess_remark, academic_year_id",
          )
          .eq("tenant_id", tenantId)
          .gte("collected_at", fromTs)
          .lt("collected_at", toTs);
        const { data, error } = await (lastId ? base.gt("id", lastId) : base)
          .order("id", { ascending: true })
          .limit(1000);
        return {
          data: (data ?? []) as PaymentRow[],
          error: error as { message: string } | null,
        };
      });
      return rows.map(mapPaymentRow);
    });
    if (!outcome.ok) {
      console.warn("[SupabaseDashboard] paymentsForRange failed (honest Err):", outcome.error);
      return Err(Errors.unknown(outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error))));
    }
    return Ok(outcome.rows);
  }

  /**
   * T-590: the installments inside the academic year's billing window
   * ([Sept 1 start, Sept 1 next) over due_date — the T-353 scoping the
   * page previously applied client-side over the FULL tenant stream). A
   * bounded keyset walk with the year window server-side; an unparseable
   * year code keeps the honest no-window full walk (the client's
   * "cannot scope" behavior). Mapped through the SAME mapInstallmentRow
   * the shared cache uses — parity by construction.
   */
  async installmentsForYear(academicYear: string): Promise<Result<Installment[]>> {
    const tenantId = this.getTenantId();
    const window = this.academicYearWindow(academicYear);
    const outcome = await readWithSeedRetry(async () => {
      const rows = await paginateKeyset(async (lastId) => {
        let base = this.client
          .from("installments")
          .select(
            "id, tenant_id, parent_id, student_id, category, label, tranche_number, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note, academic_year_id",
          )
          .eq("tenant_id", tenantId);
        if (window) {
          base = base.gte("due_date", window.from).lt("due_date", window.to);
        }
        const { data, error } = await (lastId ? base.gt("id", lastId) : base)
          .order("id", { ascending: true })
          .limit(1000);
        return {
          data: (data ?? []) as InstallmentRow[],
          error: error as { message: string } | null,
        };
      });
      // The shared cache's observable order contract: due_date ascending
      // (ISO dates sort correctly as strings; Array.sort is stable).
      return rows
        .slice()
        .sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")))
        .map(mapInstallmentRow);
    });
    if (!outcome.ok) {
      console.warn("[SupabaseDashboard] installmentsForYear failed (honest Err):", outcome.error);
      return Err(Errors.unknown(outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error))));
    }
    return Ok(outcome.rows);
  }

  // ==========================================================================
  // T-590 (E7A-1) — the compact-RPC helpers
  // ==========================================================================

  /**
   * T-590: call one of the 0002 aggregation RPCs. Returns null on the
   * unavailable class (version skew — the DB without 0002, a
   * permission-deny shape, a client without the .rpc surface at all —
   * the T-423 contract `callCollectionRpc` already established; the
   * caller falls back to the legacy client-side path, the §15.62c
   * convention); transient/other errors THROW (the readWithSeedRetry
   * ladder upstream).
   */
  private async callAggregateRpc<T>(
    fn: "read_dashboard_kpis" | "read_dashboard_revenue_by_month" | "read_dashboard_debt_aging" | "read_dashboard_demographics",
    args: Record<string, unknown>,
  ): Promise<T | null> {
    let res: Awaited<ReturnType<SupabaseClient["rpc"]>>;
    try {
      res = await this.client.rpc(fn, args);
    } catch (e) {
      if (isRpcUnavailableError(e as { message?: string })) {
        return null;
      }
      throw e;
    }
    if (res.error) {
      if (isRpcUnavailableError(res.error as { code?: string; message?: string })) {
        return null;
      }
      throw res.error;
    }
    return (res.data ?? null) as T | null;
  }

  /**
   * T-590: map the compact KPI row. The attendance ratio is computed +
   * rounded HERE (the SAME toFixed(2) arithmetic the legacy path applies —
   * the RPC returns the raw present/total counts, so zero rounding drift).
   */
  private mapKpiRpcRow(row: KpiRpcRow): DashboardKpi {
    const present = Number(row.attendancePresent) || 0;
    const total = Number(row.attendanceTotal) || 0;
    const attendanceRateToday = total > 0 ? Number(((present / total).toFixed(2))) : 1.0;
    return {
      totalStudents: Number(row.totalStudents) || 0,
      totalParents: Number(row.totalParents) || 0,
      totalStaff: Number(row.totalStaff) || 0,
      monthlyRevenue: Number(row.monthlyRevenue) || 0,
      outstandingDebt: Number(row.outstandingDebt) || 0,
      overdueAmount: Number(row.overdueAmount) || 0,
      pendingExpenses: Number(row.pendingExpenses) || 0,
      attendanceRateToday,
      overdueAlerts: Number(row.overdueAlerts) || 0,
    };
  }

  /**
   * T-590: map the compact demographics census — the EXACT mapping loop
   * the legacy path applies over the student rows (class grade_code → the
   * FR label, else the class name; an unassigned student groups by their
   * enrolled grade_level_code, else "Non assigné"; counts MERGE by final
   * label). The age buckets use the fixed ladder labels + the placeholder
   * convention (DATA-018: NULL and 2000-01-01 are "Non renseigné").
   */
  private mapDemographicsCensus(c: DemographicsCensusRow): {
    grade: DemographicSlice[];
    gender: DemographicSlice[];
    age: DemographicSlice[];
  } {
    const gradeCounts = new Map<string, number>();
    for (const cls of c.classes ?? []) {
      let gradeKey = "Non assigné";
      if (cls.grade_code && cls.grade_code in GRADE_LEVEL_LABELS_FR) {
        gradeKey = GRADE_LEVEL_LABELS_FR[cls.grade_code as GradeLevel];
      } else {
        gradeKey = cls.class_name || cls.class_id;
      }
      gradeCounts.set(gradeKey, (gradeCounts.get(gradeKey) ?? 0) + (Number(cls.student_count) || 0));
    }
    for (const lvl of c.unassignedByLevel ?? []) {
      const gradeKey =
        lvl.grade_level_code && lvl.grade_level_code in GRADE_LEVEL_LABELS_FR
          ? GRADE_LEVEL_LABELS_FR[lvl.grade_level_code as GradeLevel]
          : "Non assigné";
      gradeCounts.set(gradeKey, (gradeCounts.get(gradeKey) ?? 0) + (Number(lvl.count) || 0));
    }
    const unassignedUnknown = Number(c.unassignedUnknown) || 0;
    if (unassignedUnknown > 0) {
      gradeCounts.set("Non assigné", (gradeCounts.get("Non assigné") ?? 0) + unassignedUnknown);
    }
    const totalStudents =
      [...gradeCounts.values()].reduce((s, n) => s + n, 0) || 1;

    const grade: DemographicSlice[] = Array.from(gradeCounts.entries()).map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / totalStudents) * 100),
    }));

    const maleCount = Number(c.gender?.male) || 0;
    const femaleCount = Number(c.gender?.female) || 0;
    const unspecifiedCount = Number(c.gender?.unspecified) || 0;
    const gender: DemographicSlice[] = [
      { label: "Garçons", count: maleCount, percent: Math.round((maleCount / totalStudents) * 100) },
      { label: "Filles", count: femaleCount, percent: Math.round((femaleCount / totalStudents) * 100) },
    ];
    if (unspecifiedCount > 0) {
      gender.push({
        label: "Non spécifié",
        count: unspecifiedCount,
        percent: Math.round((unspecifiedCount / totalStudents) * 100),
      });
    }

    // The fixed age-bucket ladder (the legacy labels); the RPC counts by
    // (as-of year − birth year) — the same year-minus-year convention.
    const AGE_LADDER: Array<{ label: string; min: number; max: number }> = [
      { label: "< 6 ans", min: 0, max: 5 },
      { label: "6–8 ans", min: 6, max: 8 },
      { label: "9–11 ans", min: 9, max: 11 },
      { label: "12–14 ans", min: 12, max: 14 },
      { label: "15–17 ans", min: 15, max: 17 },
      { label: "18+ ans", min: 18, max: 120 },
    ];
    const age: DemographicSlice[] = AGE_LADDER.map((b) => {
      const row = (c.ageBuckets ?? []).find((r) => Number(r.min) === b.min && Number(r.max) === b.max);
      const count = Number(row?.count) || 0;
      return { label: b.label, count, percent: Math.round((count / totalStudents) * 100) };
    });
    const unknownBirthDate = Number(c.unknownBirthDate) || 0;
    if (unknownBirthDate > 0) {
      age.push({
        label: "Non renseigné",
        count: unknownBirthDate,
        percent: Math.round((unknownBirthDate / totalStudents) * 100),
      });
    }

    return { grade, gender, age };
  }
}