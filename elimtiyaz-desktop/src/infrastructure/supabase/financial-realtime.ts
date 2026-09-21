/**
 * Desktop financial freshness + realtime bridge.
 *
 * The financial UI consumes repository Observables, but Supabase repositories
 * intentionally keep their data in SubjectBehavior caches. Before this bridge
 * existed, those caches had only TTL/focus freshness and no event source that
 * refreshed them while the window stayed open. The result was stale payments,
 * stale tranches, stale expenses, and a debt summary that could disagree with
 * the canonical ledger replay.
 *
 * This module is deliberately an infrastructure seam, not a second financial
 * engine:
 *   - realtime events only INVALIDATE/REFRESH caches;
 *   - debt is computed through the canonical desktop ledger engine;
 *   - the existing Supabase repositories remain the mutation owners;
 *   - the existing audit_logs realtime stream is used as a fallback event bus
 *     because financial mutations are required to emit audit entries;
 *   - a low-frequency polling fallback makes freshness deterministic even when
 *     a table is not currently a member of the Supabase Realtime publication.
 *
 * No service_role/secret key is used here. The renderer uses the same public
 * Supabase client as the rest of the application.
 */

import type {
  RealtimeChannel,
  Session as SupabaseSession,
  SupabaseClient,
} from "@supabase/supabase-js";
import type { Repositories } from "../../app/providers/repository-provider";
import type { DebtRepository, Observable } from "../../domain/repository/repository";
import type { DebtSummary } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import { parentDisplayName } from "../../domain/model/parent";
import { computeParentSummary } from "../../domain/calc/ledger/balance";
import { buildOverdueDueDateMap, maxDaysOverdueFromLedger } from "../../domain/calc/ledger/overdue";
// T-405 (financial-rules §15) — the aging record type for the delegating facade.
import type { DebtAgingAnalysis } from "../../domain/calc/ledger/debt-aging";
import { agingBucketFromDays } from "../../domain/calc/payment/queries";
import { SubjectBehavior } from "../mock/subject-behavior";
import { getSupabaseRepositories } from "./supabase-repositories";
import { getTenantId } from "./repositories/supabase-shared-repositories";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  useSupabase,
} from "./supabase-client";
import type { LedgerEntryRow } from "./types";

/** Tables whose changes can invalidate the Finance hub. */
export const FINANCE_REALTIME_TABLES = [
  "payments",
  "installments",
  "ledger_entries",
  "expense_tickets",
  "parents",
  "students",
] as const;

const FINANCE_AUDIT_ACTION_PREFIXES = [
  "payment.",
  "installment.",
  "ledger.",
  "expense.",
  "debt.",
  "parent.",
  "student.",
] as const;

const FINANCE_AUDIT_ENTITY_TYPES = new Set([
  "payment",
  "installment",
  "ledger_entry",
  "expense",
  "parent",
  "student",
]);

const REFRESH_DEBOUNCE_MS = 75;
const FALLBACK_POLL_MS = 30_000;
const PAGE_SIZE = 1_000;

type DebtParent = Pick<Parent, "id" | "firstName" | "lastName" | "displayName" | "phone">;
type DebtStudent = Pick<Student, "parentId">;

/**
 * Pure canonical debt projection used by the realtime facade and its tests.
 *
 * IMPORTANT: this function does not calculate debt by summing installments.
 * It replays the canonical ledger summary for each parent, exactly like the
 * existing mock DebtRepository and the Supabase parent-financial-profile path.
 */
export function buildCanonicalDebtSummary(
  parents: readonly DebtParent[],
  students: readonly DebtStudent[],
  ledgerEntries: readonly LedgerEntry[],
): DebtSummary[] {
  return parents
    .map((parent) => {
      const parentEntries = ledgerEntries.filter((entry) => entry.parentId === parent.id);
      const dueDateMap = buildOverdueDueDateMap(parentEntries);
      const summary = computeParentSummary(
        parentEntries,
        parent.id,
        parentDisplayName(parent),
        dueDateMap,
      );
      const daysOverdue = maxDaysOverdueFromLedger(parentEntries);
      return {
        parentId: parent.id,
        parentName: parentDisplayName(parent),
        parentPhone: parent.phone,
        studentCount: students.filter((student) => student.parentId === parent.id).length,
        outstandingAmount: summary.totalOutstanding,
        daysOverdue,
        bucket: agingBucketFromDays(daysOverdue),
      } satisfies DebtSummary;
    })
    .filter((summary) => summary.outstandingAmount > 0.001)
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount);
}

/** Whether an audit event can affect a Finance surface. */
export function isFinanceAuditEvent(event: {
  action?: string | null;
  entityType?: string | null;
}): boolean {
  const action = event.action ?? "";
  const entityType = event.entityType ?? "";
  return (
    FINANCE_AUDIT_ENTITY_TYPES.has(entityType) ||
    FINANCE_AUDIT_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))
  );
}

function mapLedgerRowForCanonicalDebt(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    parentId: row.parent_id,
    studentId: row.student_id,
    category: row.category as LedgerEntry["category"],
    amount: Number(row.amount ?? 0),
    type: (row.entry_type ?? "charge") as LedgerEntry["type"],
    sourceType: (row.source_type ?? "manual_entry") as LedgerEntry["sourceType"],
    sourceId: row.source_id ?? row.id,
    method: (row.method ?? null) as LedgerEntry["method"],
    receiptNumber: row.receipt_number ?? null,
    paymentStatus: (row.payment_status ?? null) as LedgerEntry["paymentStatus"],
    reversesId: row.reverses_id ?? row.reverses_entry_id ?? null,
    description: row.description ?? "",
    actorId: row.actor_id ?? "system",
    actorName: row.actor_name ?? "System",
    at: row.at ?? row.entry_date ?? row.created_at,
    metadata: (row.metadata as LedgerEntry["metadata"]) ?? {},
  };
}

type QueryResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/** PostgREST is paginated at 1000 rows; never rely on the first page alone. */
async function fetchAllPages<T>(
  build: (from: number, to: number) => QueryResult<T>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await build(from, from + PAGE_SIZE - 1);
    if (response.error) throw new Error(response.error.message);
    const page = response.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Finance-specific DebtRepository facade.
 *
 * Existing mutation methods intentionally delegate unchanged. Only the debt
 * summary read is replaced because the original Supabase implementation was
 * a one-shot installment aggregation, while the canonical debt contract is a
 * ledger replay and must remain reactive.
 */
export class RealtimeFinancialDebtRepository implements DebtRepository {
  private readonly summary = new SubjectBehavior<DebtSummary[]>([]);
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly base: DebtRepository,
    private readonly client: SupabaseClient,
  ) {}

  observeSummary(): Observable<DebtSummary[]> {
    void this.refreshSummary();
    return this.summary;
  }

  async refreshSummary(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) {
      this.summary.set([]);
      return;
    }

    try {
      const [parents, students, ledgerRows] = await Promise.all([
        fetchAllPages((from, to) =>
          this.client
            .from("parents")
            .select("id, first_name, last_name, display_name, primary_phone")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .range(from, to),
        ),
        fetchAllPages((from, to) =>
          this.client
            .from("students")
            .select("parent_id")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .range(from, to),
        ),
        fetchAllPages((from, to) =>
          this.client
            .from("ledger_entries")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("entry_date", { ascending: true })
            .range(from, to),
        ),
      ]);

      const parentDirectory: DebtParent[] = parents.map((row) => ({
        id: String((row as { id: string }).id),
        firstName: (row as { first_name?: string | null }).first_name ?? "",
        lastName: (row as { last_name?: string | null }).last_name ?? "",
        displayName: (row as { display_name?: string | null }).display_name ?? null,
        phone: (row as { primary_phone?: string | null }).primary_phone ?? "",
      }));
      const studentDirectory: DebtStudent[] = students.map((row) => ({
        parentId: String((row as { parent_id: string }).parent_id),
      }));
      const ledgerEntries = (ledgerRows as LedgerEntryRow[]).map(mapLedgerRowForCanonicalDebt);

      this.summary.set(
        buildCanonicalDebtSummary(parentDirectory, studentDirectory, ledgerEntries),
      );
    } catch (error) {
      // Keep the last known truthful summary on a transient refresh failure.
      console.warn(
        "[FinancialRealtime] canonical debt refresh failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  observeParentProfile(parentId: string) {
    return this.base.observeParentProfile(parentId);
  }

  // T-405 — the aging surface delegates to the base repository (the
  // 0111 canonical RPC); the realtime bridge's refreshAll() forces its
  // re-query via refreshAging().
  observeAging(): Observable<DebtAgingAnalysis[]> {
    return this.base.observeAging();
  }

  async refreshAging(): Promise<void> {
    return this.base.refreshAging();
  }

  sendReminder(parentId: string) {
    return this.base.sendReminder(parentId);
  }

  broadcastReminders(minDaysOverdue?: number, actorId?: string) {
    return this.base.broadcastReminders(minDaysOverdue, actorId);
  }

  lockDelinquentAccounts(minDaysOverdue?: number, actorId?: string) {
    return this.base.lockDelinquentAccounts(minDaysOverdue, actorId);
  }
}

const installedDebtFacades = new WeakMap<Repositories, RealtimeFinancialDebtRepository>();

function installDebtFacade(
  repositories: Repositories,
  client: SupabaseClient,
): RealtimeFinancialDebtRepository {
  const existing = installedDebtFacades.get(repositories);
  if (existing) return existing;

  const facade = new RealtimeFinancialDebtRepository(repositories.debt, client);
  Object.defineProperty(repositories, "debt", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: facade,
  });
  installedDebtFacades.set(repositories, facade);
  return facade;
}

let runtimeStarted = false;

/**
 * Start the desktop Finance realtime bridge once for the process.
 *
 * The bridge waits for an authenticated Supabase session before arming the
 * channel, so realtime does not accidentally subscribe anonymously at app
 * boot and stay there after login.
 */
export async function startFinancialRealtime(): Promise<void> {
  if (runtimeStarted || !useSupabase || !isSupabaseConfigured()) return;
  runtimeStarted = true;

  try {
    const client = getSupabaseClient();
    const repositories = getSupabaseRepositories();
    const debt = installDebtFacade(repositories, client);

    let channel: RealtimeChannel | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let auditUnsubscribe: (() => void) | null = null;
    let armed = false;

    const refreshAll = async () => {
      if (!getTenantId()) return;
      // Reuse the existing repository freshness contract. Every financial
      // repository already listens for window focus; this forces its NEXT
      // observe() call to hit Supabase rather than its old cache timestamp.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("focus"));
      }

      // Calling observe() is intentional: useObservable subscribes once and
      // does not know about the cache freshness TTL, so the invalidation event
      // must explicitly kick each repository's seed path.
      repositories.parents.observe();
      repositories.students.observe();
      repositories.payments.observe();
      repositories.installments.observe();
      repositories.ledger.observe();
      repositories.expenses.observe();
      await debt.refreshSummary();
      // T-405 — the cross-year debt-aging analysis recomputes on every
      // financial mutation (§15: recalculate when payments/allocations/
      // due dates change).
      await debt.refreshAging();
    };

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshAll();
      }, REFRESH_DEBOUNCE_MS);
    };

    const disarm = () => {
      armed = false;
      if (channel) {
        void client.removeChannel(channel);
        channel = null;
      }
      auditUnsubscribe?.();
      auditUnsubscribe = null;
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
    };

    const arm = async (sessionFromEvent?: SupabaseSession | null) => {
      if (armed) return;
      const session =
        sessionFromEvent ?? (await client.auth.getSession()).data.session;
      if (!session || !getTenantId()) return;
      armed = true;

      channel = client.channel(`desktop-finance-realtime-${Date.now()}`);
      for (const table of FINANCE_REALTIME_TABLES) {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table } as never,
          () => scheduleRefresh(),
        );
      }

      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[FinancialRealtime] finance channel status: ${status}`);
        }
      });

      // The audit log publication is already known to be live in this project.
      // It is a safe fallback when a future table has not yet joined the
      // supabase_realtime publication: financial writes are required to audit.
      auditUnsubscribe = repositories.audit.observeActivity().subscribe((event) => {
        if (isFinanceAuditEvent(event)) scheduleRefresh();
      });

      fallbackTimer = setInterval(() => void refreshAll(), FALLBACK_POLL_MS);
      await refreshAll();
    };

    client.auth.onAuthStateChange((_event, session) => {
      if (session) {
        void arm(session);
      } else {
        disarm();
      }
    });

    try {
      const { data } = await client.auth.getSession();
      if (data.session) await arm(data.session);
    } catch {
      // Auth state listener remains installed and will arm after login.
    }
  } catch (error) {
    // A realtime enhancement must never prevent the desktop from starting.
    console.warn(
      "[FinancialRealtime] failed to initialize:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
