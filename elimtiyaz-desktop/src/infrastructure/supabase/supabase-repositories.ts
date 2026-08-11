/**
 * supabase-repositories — factory that builds a complete `Repositories` object
 * backed by Supabase, while gracefully falling back to mock for repositories
 * that have not yet been ported.
 *
 * ARCHITECTURE:
 *   - Auth: SupabaseAuthRepository (wraps supabase.auth) — fully implemented
 *   - Approval workflow: SupabaseApprovalRepository (wraps Edge Function) — fully implemented
 *   - Parents / Students / Payments / Ledger: Supabase implementations that
 *     call the idempotent upsert RPCs declared in migration
 *     `0027_shared_unification.sql`. These are the canonical write paths
 *     shared with the Android app.
 *   - Audit: minimal Supabase adapter calling the `write_audit_log` RPC
 *   - Notifications: minimal Supabase adapter (read + mark-read)
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
import {
  SupabaseParentRepository,
  SupabaseStudentRepository,
  SupabasePaymentRepository,
  SupabaseLedgerRepository,
  SupabaseInstallmentRepository,
  SupabaseDebtRepository,
} from "./repositories/supabase-shared-repositories";
import { SupabaseDashboardRepository } from "./repositories/supabase-dashboard-repository";

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

  // Start with the mock layer as the base, then override the repositories
  // that have Supabase implementations.
  const repositories: Repositories = {
    ...mockRepositories,
    auth,
    parents,
    students,
    payments,
    ledger,
    installments,
    debt,
    dashboard,
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
};
