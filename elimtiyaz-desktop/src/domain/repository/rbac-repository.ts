/**
 * RbacRepository — the Settings → RBAC matrix persistence seam
 * (T-588 / BUG-017 / SET-U5, migration 0006).
 *
 * BEFORE T-588 the matrix editor wrote its override to localStorage and
 * NOTHING on the enforcement path ever read it — a placebo in both modes
 * (mock sessions derive from DEFAULT_ROLE_PERMISSIONS; Supabase sessions
 * derive from the current_user_permissions() RPC). This repository is the
 * ONE canonical persistence path:
 *
 *   - Supabase implementation → the 0006 RPCs over `tenant_role_overrides`
 *     (deny-wins resolution, super_admin + tenant-scoped, transactional
 *     diff-write). The effective matrix it loads is what the server
 *     ACTUALLY enforces — including the legacy-catalog grants the desktop
 *     enum does not model (surfaced as `unmappedServerCodes`).
 *   - Mock implementation → the device-local store (offline/demo mode),
 *     same contract.
 *
 * UI note: this seam is the settings-store-unification family's tenant-level
 * store for RBAC (C-25 map: docs/architecture/settings-stores.md).
 */
import type { Result } from "../../core/result";
import type { Role } from "../../core/rbac/roles";
import type { Permission } from "../../core/rbac/permissions";
import type { RbacMatrixSaveResult, RbacMatrixResetResult } from "../model/rbac";

/** The loaded matrix: per staff role the effective permission set, plus the
 * server-only codes the desktop enum cannot display or edit (the legacy
 * catalog vocabulary — left untouched by saves). */
export interface RbacMatrixSnapshot {
  matrix: Record<Role, Permission[]>;
  /** Server-catalog codes with no desktop-enum counterpart (read-only). */
  unmappedServerCodes: string[];
  /** Does the tenant carry ANY override row (mock: a stored override that
   * differs from the defaults)? Drives the "Personnalisé" badge honestly —
   * the effective matrix can differ from the desktop defaults WITHOUT any
   * override existing (legacy server grants). */
  hasOverrides: boolean;
}

export interface RbacRepository {
  /** The tenant's CURRENT effective matrix (defaults + overrides, deny wins). */
  loadEffectiveMatrix(): Promise<Result<RbacMatrixSnapshot>>;
  /**
   * Persist the edited matrix. The Supabase implementation sends the whole
   * per-role granted/denied vocabulary and the RPC writes ONLY the diff vs
   * the role_permissions defaults (unlisted/legacy codes untouched).
   */
  saveMatrix(matrix: Record<Role, Permission[]>): Promise<Result<RbacMatrixSaveResult>>;
  /** Drop the tenant's whole override set (Réinitialiser). */
  resetMatrix(): Promise<Result<RbacMatrixResetResult>>;
}
