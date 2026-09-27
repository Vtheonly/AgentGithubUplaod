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
import { Ok, type Result } from "../../../core/result";
import type { DashboardRepository, DateRange } from "../../../domain/repository/repository";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
  DemographicSlice,
} from "../../../domain/model/operations";
import type { AgingBucket } from "../../../domain/model/payment";
import { buildWindowAnchoredBuckets, daysBetweenFloor } from "../../../domain/calc/shared/dates";
import { agingBucketFromDays } from "../../../domain/calc/payment/queries";
import { callCollectionRpc, paginateKeyset } from "./supabase-shared-repositories";
import type { PaymentRow, InstallmentRow } from "../types";
import { GRADE_LEVEL_LABELS_FR, IMPORTED_BIRTH_DATE_PLACEHOLDER, type GradeLevel } from "../../../domain/model/student";

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
  /**
   * DUP-007 (T-411, FA-15d): the CURRENT school year derived from the
   * clock (September rollover) — the hardcoded "2025-2026" defaults kept
   * answering with the previous year after rollover.
   */
  private currentAcademicYear(): string {
    const now = new Date();
    const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return `${start}-${start + 1}`;
  }

  private academicYearWindow(academicYear: string): { from: string; to: string } | null {
    const m = /^(\d{4})-(\d{4})$/.exec(academicYear);
    if (!m) return null;
    const start = parseInt(m[1], 10);
    return { from: `${start}-09-01`, to: `${start + 1}-09-01` };
  }

  async kpis(): Promise<Result<DashboardKpi>> {
    return this.kpisForRange(this.currentAcademicYear());
  }

  async kpisForRange(academicYear: string, range?: DateRange): Promise<Result<DashboardKpi>> {
    const tenantId = this.getTenantId();

    try {
      const now = new Date();
      const monthStart = range?.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = range?.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
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
        this.client
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        this.client
          .from("parents")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        this.client
          .from("personnel")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
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
      const overdueAlerts = allInstallments.filter((i) => i.status === "overdue").length;

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
        pendingExpenses: expensesRes.count ?? 0,
        attendanceRateToday,
        overdueAlerts,
      });
    } catch (err) {
      console.warn("[SupabaseDashboard] kpisForRange error, using fallback zeroes:", err);
      return Ok({
        totalStudents: 0,
        totalParents: 0,
        totalStaff: 0,
        monthlyRevenue: 0,
        outstandingDebt: 0,
        pendingExpenses: 0,
        attendanceRateToday: 1.0,
        overdueAlerts: 0,
      });
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
    return this.revenueForRange(this.currentAcademicYear());
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
    return this.debtByAgingForRange(this.currentAcademicYear());
  }

  async debtByAgingForRange(academicYear: string, range?: DateRange): Promise<Result<DebtByAgingBucket[]>> {
    const tenantId = this.getTenantId();

    const bucketKeys: AgingBucket[] = ["0_30", "31_60", "61_90", "91_180", "180_plus"];
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
      console.warn("[SupabaseDashboard] debt aging exception:", err);
      return Ok(bucketKeys.map((k) => ({ bucket: k, amount: 0, debtorCount: 0 })));
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
      // 1. Fetch only verified columns on students (no 'level' or 'grade_year').
      // T-339 (STATS-400): the classes query drops `capacity` — the fill-rate
      // slice was REMOVED (a class has no artificial maximum; the replacement
      // is the section-imbalance derivation, see executive-statistics.ts).
      const [studentsRes, classesRes] = await Promise.all([
        this.client
          .from("students")
          .select("id, gender, date_of_birth, class_id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
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
}