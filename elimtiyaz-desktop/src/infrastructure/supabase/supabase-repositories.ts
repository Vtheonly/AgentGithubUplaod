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
