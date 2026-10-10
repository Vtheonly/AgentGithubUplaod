/**
 * SupabaseOnboardingRepository — Supabase-backed implementation of the
 * `OnboardingRepository` domain contract (T-483, 140th session, 2026-10-04 —
 * the T-477 audit's "onboarding mock slot (persists nothing)" fix).
 *
 * THE MODEL RULING (migration 0142): the wizard's domain state is a TENANT
 * SINGLETON (the §10-config first-run setup: departments/roles/employees/
 * admins/managers/working-hours/shift-types/permissions), while 0010's
 * `onboarding_states` table is per-personnel (plan §10.10 — per-employee
 * onboarding progress). The ruling keeps BOTH models: the tenant wizard
 * persists as the table's `personnel_id IS NULL` row (exactly one per
 * tenant — the 0142 partial unique index enforces it), and the
 * per-personnel rows keep the 0010 semantics untouched for the future
 * employee-level onboarding.
 *
 * MAPPING NOTES (documented):
 *   1. currentStep: OnboardingStep (the step NAME) ↔ the table's
 *      current_step INTEGER (the zero-based index into ONBOARDING_STEPS).
 *      The 0010 column was designed for a linear per-employee wizard; the
 *      domain uses named steps. Index round-trip with range guards: a
 *      stored index outside [0, ONBOARDING_STEPS.length) folds to "welcome"
 *      (a corrupt row never crashes the gate).
 *   2. completedSteps: ReadonlySet<OnboardingStep> ↔ the table's
 *      completed_steps integer[]. Same index mapping, per-element guards
 *      (out-of-range indices dropped); the domain Set is rebuilt.
 *   3. data: OnboardingData ↔ data_json jsonb (the whole payload verbatim —
 *      the mock stores the same shape in memory).
 *   4. tenantId ↔ tenant_id (getTenantId()); startedAt ↔ started_at;
 *      completedAt ↔ completed_at (NULL = in progress — the personnel-page
 *      gate's exact contract).
 *   5. reset() = DELETE the singleton row + start() (the mock's
 *      null-then-start semantics on the real storage).
 *   6. isComplete() = the singleton row's completed_at IS NOT NULL.
 *
 * RLS (0019): the singleton row (personnel_id NULL) is visible/writable by
 * the staff quartet only (onboarding_states_admin covers for-all; the
 * select policy's own-personnel arm cannot match a NULL personnel_id —
 * exactly the intended visibility for a tenant-level wizard).
 *
 * Reactive reads follow the shared pattern: SubjectBehavior cache +
 * T-034/CACHE-103 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `onboarding` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { OnboardingRepository } from "../../../domain/repository/workforce-repository";
import type {
  OnboardingState,
  OnboardingStep,
  OnboardingData,
} from "../../../domain/model/workforce";
import { ONBOARDING_STEPS } from "../../../domain/model/workforce";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { getTenantId, getActorId, getActorName, writeAuditMirror } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types + the step-index mapping (notes 1–2)
// ============================================================================

interface OnboardingRow {
  id: string;
  tenant_id: string;
  personnel_id: string | null;
  current_step: number;
  completed_steps: number[] | null;
  started_at: string;
  completed_at: string | null;
  data_json: Record<string, unknown> | null;
}

function stepToIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

function indexToStep(index: number): OnboardingStep {
  return index >= 0 && index < ONBOARDING_STEPS.length
    ? ONBOARDING_STEPS[index]!
    : "welcome";
}

function mapRow(row: OnboardingRow): OnboardingState {
  return {
    tenantId: row.tenant_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    currentStep: indexToStep(row.current_step),
    completedSteps: new Set<OnboardingStep>(
      (row.completed_steps ?? [])
        .filter((i) => i >= 0 && i < ONBOARDING_STEPS.length)
        .map((i) => ONBOARDING_STEPS[i]!),
    ),
    data: (row.data_json ?? {}) as unknown as OnboardingData,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseOnboardingRepository implements OnboardingRepository {
  private readonly cache = new SubjectBehavior<OnboardingState | null>(null);
  private readonly freshness = new CacheFreshness();
  private loaded = false;

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<OnboardingState | null> {
    this.seed();
    return {
      subscribe: (fn: (value: OnboardingState | null) => void) =>
        this.cache.subscribe(fn),
      get: (): OnboardingState | null => this.cache.get(),
    };
  }

  async start(): Promise<Result<OnboardingState>> {
    const startedAt = new Date().toISOString();
    const startedPatch = {
      current_step: stepToIndex("welcome"),
      completed_steps: [],
      started_at: startedAt,
      completed_at: null,
      data_json: this.emptyData() as unknown as Record<string, unknown>,
    };
    // MAPPING NOTE (the Postgres NULL-on-conflict trap): the singleton row
    // carries personnel_id NULL, and `ON CONFLICT (tenant_id, personnel_id)`
    // can NEVER match a NULL column (NULL != NULL in unique-index
    // semantics) — a naive upsert would INSERT a second row and die on the
    // 0142 partial unique index instead. start() is therefore
    // read-then-write: UPDATE the existing singleton row (restart in
    // place — the mock's null-then-start semantics) or INSERT the first
    // one. A concurrent double-start surfaces the unique violation
    // honestly (the wizard is a single-admin session by construction).
    const existing = await this.readRow();
    if (existing === "error") {
      return Err(Errors.validation("L'onboarding est illisible (ligne singleton inaccessible)."));
    }
    let data: unknown;
    let error: { message: string; code?: string } | null = null;
    if (existing !== null) {
      const res = await this.client
        .from("onboarding_states")
        .update(startedPatch)
        .eq("id", existing.id)
        .select()
        .single();
      data = res.data;
      error = res.error as { message: string; code?: string } | null;
    } else {
      const res = await this.client
        .from("onboarding_states")
        .insert({
          tenant_id: getTenantId(),
          personnel_id: null, // the T-483 tenant-singleton row (0142)
          ...startedPatch,
        })
        .select()
        .single();
      data = res.data;
      error = res.error as { message: string; code?: string } | null;
    }
    if (error) return Err(supabaseErrorToAppError(error as never));
    await this.refresh();
    // AUDIT-505 (T-502): onboarding.start — the mock's mirror (the tenant
    // singleton as the entity, the session actor attributed — the mock's
    // actorless row is the one deliberate improvement).
    await writeAuditMirror(this.client, {
      action: "onboarding.start",
      entityType: "onboarding",
      entityId: getTenantId(),
      actorId: getActorId(),
      actorName: getActorName(),
    });
    return Ok(mapRow(data as unknown as OnboardingRow));
  }

  async advanceTo(step: OnboardingStep): Promise<Result<OnboardingState>> {
    return this.mutate(async () => ({
      current_step: stepToIndex(step),
    }));
  }

  async completeStep(step: OnboardingStep): Promise<Result<OnboardingState>> {
    return this.mutate(async (row) => {
      const done = new Set(row.completed_steps ?? []);
      done.add(stepToIndex(step));
      return { completed_steps: [...done] };
    });
  }

  async updateData(
    updates: Partial<OnboardingData>,
  ): Promise<Result<OnboardingState>> {
    return this.mutate(async (row) => ({
      data_json: { ...(row.data_json ?? {}), ...updates },
    }));
  }

  async complete(): Promise<Result<OnboardingState>> {
    const nowIso = new Date().toISOString();
    const result = await this.mutate(async () => ({
      completed_at: nowIso,
      current_step: stepToIndex("done"),
      completed_steps: ONBOARDING_STEPS.map((_, i) => i),
    }));
    if (result.ok) {
      // AUDIT-505 (T-502): onboarding.complete — the mock's mirror.
      await writeAuditMirror(this.client, {
        action: "onboarding.complete",
        entityType: "onboarding",
        entityId: getTenantId(),
        actorId: getActorId(),
        actorName: getActorName(),
      });
    }
    return result;
  }

  async reset(): Promise<Result<OnboardingState>> {
    // The mock's reset semantics on the real storage: the row is DELETED,
    // then start() recreates it fresh (the wizard's gate re-opens).
    const { error } = await this.client
      .from("onboarding_states")
      .delete()
      .eq("tenant_id", getTenantId())
      .is("personnel_id", null);
    if (error) return Err(supabaseErrorToAppError(error));
    // AUDIT-505 (T-502): onboarding.reset BEFORE start() re-audits — the
    // reset row records the deletion, the start row the recreation (the
    // mock audits both events; entityId = the tenant singleton).
    await writeAuditMirror(this.client, {
      action: "onboarding.reset",
      entityType: "onboarding",
      entityId: getTenantId(),
      actorId: getActorId(),
      actorName: getActorName(),
    });
    return this.start();
  }

  async isComplete(): Promise<Result<boolean>> {
    const row = await this.readRow();
    if (row === "error") {
      return Err(Errors.validation("L'onboarding est illisible (ligne singleton inaccessible)."));
    }
    return Ok(row?.completed_at != null);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private emptyData(): OnboardingData {
    return {
      departments: [],
      roles: [],
      employeeCount: 0,
      adminIds: [],
      managerAssignments: [],
      workingHours: { start: "08:00", end: "17:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
      shiftTypes: [],
      permissionOverrides: {},
    };
  }

  /** The current singleton row, or null (no row), or "error". */
  private async readRow(): Promise<OnboardingRow | null | "error"> {
    const { data, error } = await this.client
      .from("onboarding_states")
      .select("*")
      .eq("tenant_id", getTenantId())
      .is("personnel_id", null)
      .maybeSingle();
    if (error) return "error";
    return (data as unknown as OnboardingRow) ?? null;
  }

  /** Read-modify-write the singleton row, then refresh the cache. */
  private async mutate(
    apply: (row: OnboardingRow) => Promise<Record<string, unknown>>,
  ): Promise<Result<OnboardingState>> {
    const current = await this.readRow();
    if (current === "error") {
      return Err(Errors.validation("L'onboarding est illisible (ligne singleton inaccessible)."));
    }
    if (current === null) {
      return Err(
        Errors.validation(
          "L'onboarding n'a pas été démarré (aucune ligne singleton — appelez start() d'abord).",
        ),
      );
    }
    const patch = await apply(current);
    const { data, error } = await this.client
      .from("onboarding_states")
      .update(patch)
      .eq("id", current.id)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapRow(data as unknown as OnboardingRow));
  }

  private seed(): void {
    if (this.loaded && !this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh().then(() => {
      this.loaded = true;
    });
  }

  private async refresh(): Promise<void> {
    try {
      const row = await this.readRow();
      if (row === "error") return; // silently degrade to the current cache
      this.cache.set(row ? mapRow(row) : null);
    } catch {
      // Silently degrade to the current cache.
    }
  }
}
