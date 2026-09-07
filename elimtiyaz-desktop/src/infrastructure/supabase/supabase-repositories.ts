/**
 * supabase-repositories — factory that builds a complete `Repositories` object
 * backed by Supabase, while gracefully falling back to mock for repositories
 * that have not yet been ported.
 *
 * ARCHITECTURE:
 *   - Auth: SupabaseAuthRepository (wraps supabase.auth) — fully implemented
 *   - Approval workflow: SupabaseApprovalRepository (wraps Edge Function) — fully implemented
 *   - Parents / Students / Payments / Ledger / Installments / Debt: Supabase
 *     implementations that call the idempotent upsert RPCs declared in
 *     migration `0027_shared_unification.sql`. These are the canonical write
 *     paths shared with the Android app.
 *   - Dashboard: SupabaseDashboardRepository (KPIs straight from the tables)
 *   - Academics (DESKTOP-1): academic years, classes, subjects (+class-subject
 *     assignments), grades/assessments, attendance, homework and batch
 *     promotion — see `supabase-academic-repository.ts` (tables 0004 + 0029).
 *   - Audit (DESKTOP-1): SupabaseAuditLogRepository — `write_audit_log` RPC
 *     (migration 0014) + filtered queries on `audit_logs` (Settings → Journal
 *     d'audit reads real data).
 *   - Notifications (DESKTOP-1): SupabaseNotificationRepository — `notifications`
 *     table (migration 0013) with the observable-cache pattern.
 *   - Personnel + Departments (DESKTOP-1): entity CRUD on `personnel` (0009)
 *     and `departments` (0010). Releve/timesheets, workforce tasks, chat,
 *     shifts, schedules and onboarding remain on the mock layer.
 *   - All other repositories: FALLBACK to mock implementations with a console
 *     warning. This allows incremental migration — each repository can be
 *     ported to Supabase independently without blocking the release.
 *
 * PLAN §12.05: service_role key is NEVER used here. All client-side access uses
 * the anon key, gated by RLS.
 *
 * MIGRATION PATH:
 *   1. Start with mockRepositories (VITE_USE_SUPABASE=false)
 *   2. Set VITE_USE_SUPABASE=true to enable Supabase auth + approval workflow
 *   3. As each repository is ported, replace its mock with the Supabase impl
 *      in the `getSupabaseRepositories()` function below.
 */

import type { Repositories } from "../../app/providers/repository-provider";
import { mockRepositories } from "../../app/providers/repository-provider";
import { getSupabaseClient } from "./supabase-client";
import { SupabaseAuthRepository } from "./repositories/supabase-auth-repository";
import { SupabaseApprovalRepository } from "./repositories/supabase-approval-repository";
import { SupabaseUserAccountRepository } from "./repositories/supabase-user-account-repository";
import {
  SupabaseParentRepository,
  SupabaseStudentRepository,
  SupabasePaymentRepository,
  SupabaseLedgerRepository,
  SupabaseInstallmentRepository,
  SupabaseDebtRepository,
} from "./repositories/supabase-shared-repositories";
import { SupabaseDashboardRepository } from "./repositories/supabase-dashboard-repository";
import { SupabaseOverdueAlertGenerator } from "./repositories/supabase-overdue-alert-generator";
import { SupabaseExpenseRepository } from "./repositories/supabase-expense-repository";
import { SupabaseChatRepository } from "./repositories/supabase-chat-repository";
import { SupabaseCalendarRepository } from "./repositories/supabase-calendar-repository";
import { SupabaseWorkflowRepository } from "./repositories/supabase-workflow-repository";
import { SupabaseWorkflowRunRepository } from "./repositories/supabase-workflow-run-repository";
import { SupabaseLeaveRequestRepository } from "./repositories/supabase-leave-request-repository";
import { SupabaseSupplierRepository } from "./repositories/supabase-supplier-repository";
import { SupabaseTaskRepository } from "./repositories/supabase-task-repository";
import { SupabaseWorkforceAttendanceRepository } from "./repositories/supabase-workforce-attendance-repository";
import { SupabasePurchaseRequestRepository } from "./repositories/supabase-purchase-request-repository";
import { SupabaseDeliveryRepository } from "./repositories/supabase-delivery-repository";
import { SupabaseInventoryRepository } from "./repositories/supabase-inventory-repository";
import {
  SupabaseAcademicYearRepository,
  SupabaseClassRepository,
  SupabaseSubjectRepository,
  SupabaseGradeRepository,
  SupabaseAttendanceRepository,
  SupabaseHomeworkRepository,
  SupabasePromotionRepository,
} from "./repositories/supabase-academic-repository";
import { SupabaseAuditLogRepository } from "./repositories/supabase-audit-log-repository";
import { SupabaseNotificationRepository } from "./repositories/supabase-notification-repository";
import {
  SupabasePersonnelRepository,
  SupabaseDepartmentRepository,
  RoleLookup,
} from "./repositories/supabase-personnel-repository";

/**
 * Build a Repositories object backed by Supabase for auth + approval workflow,
 * falling back to mock for repositories not yet ported.
 *
 * Cached — the same Repositories instance is returned across calls within
 * a single renderer process.
 */
let _supabaseRepositories: Repositories | null = null;

export function getSupabaseRepositories(): Repositories {
  if (_supabaseRepositories) {
    return _supabaseRepositories;
  }

  const client = getSupabaseClient();
  const auth = new SupabaseAuthRepository(client);
  const approvals = new SupabaseApprovalRepository(client);
  // T-079 — admin account provisioning goes through the create-user-account
  // EF (super_admin only). Explicitly overrides the mock spread below: in
  // Supabase mode, minting into the in-memory seedAccounts would create an
  // account nobody can actually sign in with.
  const userAccounts = new SupabaseUserAccountRepository(client);

  // Shared entities — backed by the migration 0027 RPCs.
  const parents = new SupabaseParentRepository(client);
  const students = new SupabaseStudentRepository(client);
  const payments = new SupabasePaymentRepository(client);
  const ledger = new SupabaseLedgerRepository(client);
  // CRITICAL FIX: Installments + Debt MUST also read from Supabase —
  // previously they fell back to the mock store, so when the Excel importer
  // wrote to Supabase (parents/students/payments/ledger) the student
  // payments tab kept showing "no installments" / "no payment history"
  // even though the data existed in Supabase. Now they read from the
  // same Supabase tables the importer writes to.
  const installments = new SupabaseInstallmentRepository(client);
  const debt = new SupabaseDebtRepository(client);
  // CRITICAL FIX: Dashboard MUST also read from Supabase — previously it
  // fell back to the mock store, so when the Excel importer wrote to
  // Supabase (parents/students/payments/ledger) the dashboard kept showing
  // the mock seed data (or zeros) instead of the real imported numbers.
  const dashboard = new SupabaseDashboardRepository(client);

  // DESKTOP-1 — Academics: previously every academic entity silently fell
  // back to the mock store in Supabase mode, so classes / subjects / grades /
  // attendance / homework created in the UI were never persisted and the
  // screens showed mock seed data instead of the (empty) live tables.
  const academicYears = new SupabaseAcademicYearRepository(client);
  const classes = new SupabaseClassRepository(client);
  const subjects = new SupabaseSubjectRepository(client);
  const grades = new SupabaseGradeRepository(client);
  const attendance = new SupabaseAttendanceRepository(client);
  const homework = new SupabaseHomeworkRepository(client);
  const promotion = new SupabasePromotionRepository(client);

  // DESKTOP-1 — Audit: Settings → Journal d'audit now queries the real
  // `audit_logs` table (migration 0014) and every `log()` call appends via
  // the canonical `write_audit_log` RPC.
  const audit = new SupabaseAuditLogRepository(client);

  // DESKTOP-1 — Notifications: alerts feed reads/writes the `notifications`
  // table (migration 0013).
  const notifications = new SupabaseNotificationRepository(client);

  // DESKTOP-1 — Personnel + departments (entity CRUD only — the remaining
  // workforce repositories stay mock-backed). The RoleLookup is shared
  // between personnel writes (role code → uuid) and reads (uuid → code).
  const roleLookup = new RoleLookup(client);
  const personnel = new SupabasePersonnelRepository(client, roleLookup);
  const departments = new SupabaseDepartmentRepository(client);

  // T-080 (2026-08-30, ARCH-006 fix): wire the Supabase-backed overdue
  // alert generator. BEFORE this, the `overdueAlerts` slot stayed on
  // MockOverdueAlertGenerator even in Supabase mode — the dashboard's
  // "Scan retards" button scanned in-memory seed data and persisted
  // nothing server-side. The guarded `run-overdue-scan` EF (T-004)
  // had no live desktop caller as a result. Now the desktop path
  // scans real installments + writes real `notifications` rows.
  const overdueAlerts = new SupabaseOverdueAlertGenerator(client);

  // T-093 (2026-08-31, DRIFT-013 fix): wire the Supabase-backed expenses
  // repository onto the canonical `expense_tickets` table (migration 0008,
  // status/category translation layer inside the adapter). BEFORE this,
  // the `expenses` slot stayed on MockExpenseRepository even in Supabase
  // mode — submitted expense requests were never persisted server-side and
  // the tickets list showed seed data.
  const expenses = new SupabaseExpenseRepository(client);

  // T-099 (2026-08-31, CHAT-103/105 fix): wire the Supabase-backed chat
  // repository onto chat_channels/chat_messages (migration 0010 + 0051 +
  // 0061). BEFORE this, the `chat` slot stayed on mockRepositories —
  // staff-to-staff chat was in-memory only (wiped on every restart) and the
  // parent portal could never see any conversation (CHAT-103: no production
  // writer). The 0061 create_direct_channel RPC is the canonical,
  // idempotent DM-creation path used by this repository.
  const chat = new SupabaseChatRepository(client);

  // T-175 (2026-09-05, T-047 port #1): wire the Supabase-backed calendar
  // repository onto `calendar_events` (migration 0013 + 0070). BEFORE this,
  // the `calendar` slot stayed on mockRepositories even in Supabase mode —
  // staff-scheduled events (follow-up calls, reminders, meetings) were
  // in-memory only (wiped on restart, never persisted server-side) and the
  // derived payment/audit/expense events were computed from the mock SEED
  // data while real rows lived in Supabase. The T-160 scoping ranked this
  // the #1 port: the website already reads calendar_events (the only slot
  // with a verified live cross-platform read today).
  const calendar = new SupabaseCalendarRepository(client);

  // T-176/T-177 (2026-09-05, T-047 ports #2a/#2b): wire the Supabase-backed
  // workflow + workflow-run repositories onto workflows / workflow_runs
  // (migration 0012 + 0071). BEFORE this, both slots stayed on
  // mockRepositories even in Supabase mode — desktop-authored workflow
  // definitions and manual executions lived in memory only (wiped on
  // restart) while ANDROID pull-syncs workflow_runs (PullSyncRepository):
  // the two platforms showed different execution histories. execute() now
  // goes through the canonical workflow-execute EF (ADR-002 — cycle
  // detection, daily cap and the runs row all happen server-side).
  const workflows = new SupabaseWorkflowRepository(client);
  const workflowRuns = new SupabaseWorkflowRunRepository(client, workflows);

  // T-178 (2026-09-05, T-047 port #3): wire the Supabase-backed leave-request
  // repository onto leave_requests (migration 0010 + 0072 — the 0072 widening
  // stores the domain RequestType union directly + reviewed_by_name). BEFORE
  // this, the slot stayed on mockRepositories even in Supabase mode — worker-
  // submitted leave/absence/overtime requests lived in memory only (wiped on
  // restart) while the canonical table sat empty. RLS matches the domain's
  // only UI call sites: INSERT for any tenant member (worker submit), UPDATE
  // for manager/super_admin (decide).
  const leaveRequests = new SupabaseLeaveRequestRepository(client);

  // T-179 (2026-09-05, T-047 port #4): wire the Supabase-backed supplier
  // repository onto suppliers (migration 0011 + 0073 — category column +
  // fractional rating). BEFORE this, the buyer dashboard's supplier list
  // (name lookups for purchase requests + the KPI count) came from the mock
  // SEED data while the canonical table sat empty.
  const suppliers = new SupabaseSupplierRepository(client);

  // T-180 (2026-09-05, T-047 port #5): wire the Supabase-backed task
  // repository onto tasks / task_comments / task_attachments (migration
  // 0010 + 0074 display-name columns). BEFORE this, the worker/manager/buyer
  // dashboards' task lists, the management screens and every status change
  // lived in mock memory only (wiped on restart) while the canonical tables
  // sat empty.
  const tasks = new SupabaseTaskRepository(client);

  // T-217 (2026-09-07, T-047 port #6): wire the Supabase-backed workforce
  // attendance repository onto workforce_attendance_events (migration 0010).
  // BEFORE this, the worker dashboard's clock punches, the manager
  // dashboard's daily attendance feed and the employee profile drawer's
  // attendance history lived in mock memory only (wiped on restart) while
  // the canonical table sat empty. RLS (0019): SELECT tenant + (staff OR
  // own-personnel), INSERT tenant — matching the domain's call sites.
  const workforceAttendance = new SupabaseWorkforceAttendanceRepository(client);

  // T-238 (2026-09-07, 35th session, T-047 port #7): wire the Supabase-backed
  // purchase-request repository onto purchase_requests (migration 0011 +
  // 0084 display names). BEFORE this, the buyer dashboard's procurement
  // pipeline (draft → submitted → approved → ordered → received) lived in
  // mock memory only (wiped on restart) while the canonical table sat empty.
  // RLS (0019): SELECT staff-trio OR own requests; INSERT any tenant member;
  // UPDATE admin/manager/buyer.
  const purchaseRequests = new SupabasePurchaseRequestRepository(client);

  // T-239 (2026-09-07, 35th session, T-047 port #8): wire the Supabase-backed
  // delivery repository onto deliveries (migration 0011 + 0084 driver_name /
  // new_eta). BEFORE this, the driver dashboard's delivery dispatching, stops
  // and delay reporting lived in mock memory only. RLS (0019): SELECT
  // staff-trio OR own driver assignments; writes super_admin/manager.
  const deliveries = new SupabaseDeliveryRepository(client);

  // T-240 (2026-09-07, 35th session, T-047 port #9): wire the Supabase-backed
  // inventory repository onto inventory_items + inventory_transactions
  // (migration 0011 + 0084 frozen before/after + actor names). BEFORE this,
  // the warehouse dashboard's stock, scanning and damage declarations lived
  // in mock memory only. RLS (0019): item writes
  // super_admin/warehouse_worker/manager; transaction inserts
  // super_admin/warehouse_worker/buyer/manager.
  const inventory = new SupabaseInventoryRepository(client);

  // Start with the mock layer as the base, then override the repositories
  // that have Supabase implementations.
  const repositories: Repositories = {
    ...mockRepositories,
    auth,
    userAccounts,
    parents,
    students,
    payments,
    ledger,
    installments,
    debt,
    dashboard,
    // DESKTOP-1 — newly Supabase-backed:
    academicYears,
    classes,
    subjects,
    grades,
    attendance,
    homework,
    promotion,
    audit,
    notifications,
    personnel,
    departments,
    overdueAlerts, // T-080 — kill the mock leak
    expenses, // T-093 — expense tickets on the canonical expense_tickets table
    chat, // T-099 — chat on chat_channels/chat_messages (CHAT-105 dead)
    calendar, // T-175 — calendar on calendar_events (T-047 port #1)
    workflows, // T-176 — workflows on the workflows table (T-047 port #2a)
    workflowRuns, // T-177 — workflow_runs + canonical execute EF (T-047 port #2b)
    leaveRequests, // T-178 — leave_requests (T-047 port #3, migration 0072)
    suppliers, // T-179 — suppliers (T-047 port #4, migration 0073)
    tasks, // T-180 — tasks/task_comments/task_attachments (T-047 port #5, migration 0074)
    workforceAttendance, // T-217 — workforce_attendance_events (T-047 port #6)
    purchaseRequests, // T-238 — purchase_requests (T-047 port #7)
    deliveries, // T-239 — deliveries (T-047 port #8)
    inventory, // T-240 — inventory_items + transactions (T-047 port #9)
    // Other repositories remain on the mock layer for now. They will be
    // ported incrementally. Each port replaces the corresponding mock with
    // a Supabase-backed implementation.
  };

  // Attach the approvals repository as a non-standard property. Components
  // that need approval functionality can access it via:
  //   const repos = useRepositories() as RepositoriesWithApprovals;
  //   repos.approvals.listPending()
  Object.assign(repositories, { approvals });

  _supabaseRepositories = repositories;
  return repositories;
}

/**
 * Extended Repositories interface that includes the approval workflow.
 * Components that need approval functionality can cast to this type.
 */
export interface RepositoriesWithApprovals extends Repositories {
  approvals: SupabaseApprovalRepository;
}

export {
  SupabaseAuthRepository,
  SupabaseChatRepository,
  SupabaseApprovalRepository,
  SupabaseParentRepository,
  SupabaseStudentRepository,
  SupabasePaymentRepository,
  SupabaseLedgerRepository,
  SupabaseInstallmentRepository,
  SupabaseDebtRepository,
  SupabaseDashboardRepository,
  SupabaseAcademicYearRepository,
  SupabaseClassRepository,
  SupabaseSubjectRepository,
  SupabaseGradeRepository,
  SupabaseAttendanceRepository,
  SupabaseHomeworkRepository,
  SupabasePromotionRepository,
  SupabaseAuditLogRepository,
  SupabaseNotificationRepository,
  SupabasePersonnelRepository,
  SupabaseDepartmentRepository,
  SupabaseOverdueAlertGenerator, // T-080 — Supabase-backed overdue scan
  SupabaseExpenseRepository, // T-093 — expense tickets on expense_tickets
};
