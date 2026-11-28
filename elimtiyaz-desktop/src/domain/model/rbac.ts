/**
 * RBAC persistence — the canonical device-local override store (T-588/BUG-017).
 *
 * The TENANT-LEVEL source of truth for the RBAC matrix override is the
 * `tenant_role_overrides` table (migration 0006's read/save/reset RPCs).
 * This key is the MOCK-mode (offline/demo) persistence medium — the same
 * role the mock store plays for every other repository — and the backup
 * snapshot's capture point (VAULT §13.01): exactly ONE canonical constant,
 * shared by the mock repository, the backup snapshot reader, and the
 * mock-store restore path, so the three can never disagree again (the
 * T-581/BUG-050 class of key-mismatch defect).
 *
 * Shape (JSON): `{ [role: string]: string[] }` — per staff role, the FULL
 * effective permission-code list (defaults + edits — the editor saves the
 * whole matrix, not a diff; the Supabase path diffs server-side instead).
 */
export const RBAC_OVERRIDES_STORAGE_KEY = "el-imtiyaz:rbac-overrides";

/** The save result mirrored from the 0006 `save_rbac_matrix` RPC. */
export interface RbacMatrixSaveResult {
  /** Override cells written (a grant or deny that differs from the default). */
  saved: number;
  /** Stale override rows removed (desired == default again). */
  removed: number;
}

/** The reset result mirrored from the 0006 `reset_rbac_matrix` RPC. */
export interface RbacMatrixResetResult {
  removed: number;
}
