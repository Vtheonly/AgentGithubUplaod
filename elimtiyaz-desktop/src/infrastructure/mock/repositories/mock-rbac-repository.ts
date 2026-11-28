/**
 * MockRbacRepository — the offline/demo persistence for the RBAC matrix
 * override (T-588/BUG-017), backed by the ONE canonical device-local key.
 *
 * The mock store is also the backup snapshot's capture point (VAULT §13.01),
 * so restore round-trips keep working in mock mode.
 */
import type {
  RbacRepository,
  RbacMatrixSnapshot,
} from "../../../domain/repository/rbac-repository";
import type {
  RbacMatrixSaveResult,
  RbacMatrixResetResult,
} from "../../../domain/model/rbac";
import { RBAC_OVERRIDES_STORAGE_KEY } from "../../../domain/model/rbac";
import { Ok, Err, type Result } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { Role, STAFF_ROLES } from "../../../core/rbac/roles";
import { Permission, DEFAULT_ROLE_PERMISSIONS } from "../../../core/rbac/permissions";

/** The enum's value set (string enums carry NO reverse mapping, so `in`
 * checks KEYS — a subtle full-drop bug this guard exists to prevent). */
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(Permission) as string[]);

/** Parse the stored override (defensive — a corrupt payload falls back to defaults). */
export function loadRbacOverride(): Record<Role, Permission[]> | null {
  try {
    const raw = localStorage.getItem(RBAC_OVERRIDES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const result = {} as Record<Role, Permission[]>;
    for (const role of STAFF_ROLES) {
      const arr = parsed[role];
      result[role] = Array.isArray(arr)
        ? arr.filter((c): c is Permission => KNOWN_CODES.has(c))
        : Array.from(DEFAULT_ROLE_PERMISSIONS[role]);
    }
    return result;
  } catch {
    return null;
  }
}

function saveRbacOverride(matrix: Record<Role, Permission[]>): void {
  const serializable: Record<string, Permission[]> = {};
  for (const role of STAFF_ROLES) {
    serializable[role] = Array.from(matrix[role] ?? []);
  }
  localStorage.setItem(RBAC_OVERRIDES_STORAGE_KEY, JSON.stringify(serializable));
}

function clearRbacOverride(): void {
  localStorage.removeItem(RBAC_OVERRIDES_STORAGE_KEY);
}

export class MockRbacRepository implements RbacRepository {
  async loadEffectiveMatrix(): Promise<Result<RbacMatrixSnapshot>> {
    const stored = loadRbacOverride();
    const matrix = {} as Record<Role, Permission[]>;
    let differs = false;
    for (const role of STAFF_ROLES) {
      const list = stored?.[role] ?? Array.from(DEFAULT_ROLE_PERMISSIONS[role]);
      matrix[role] = list;
      const a = [...list].sort();
      const b = [...DEFAULT_ROLE_PERMISSIONS[role]].sort();
      if (JSON.stringify(a) !== JSON.stringify(b)) differs = true;
    }
    // The mock has no separate server catalog — nothing is unmapped.
    return Ok({ matrix, unmappedServerCodes: [], hasOverrides: differs });
  }

  async saveMatrix(matrix: Record<Role, Permission[]>): Promise<Result<RbacMatrixSaveResult>> {
    try {
      saveRbacOverride(matrix);
      return Ok({ saved: Object.keys(matrix).length, removed: 0 });
    } catch (err) {
      return Err(Errors.unknown(err instanceof Error ? err.message : String(err)));
    }
  }

  async resetMatrix(): Promise<Result<RbacMatrixResetResult>> {
    try {
      clearRbacOverride();
      return Ok({ removed: 0 });
    } catch (err) {
      return Err(Errors.unknown(err instanceof Error ? err.message : String(err)));
    }
  }
}
/** The shared singleton (the backup repository lazy Repositories ref and
 * the mock composite both mount the SAME instance). */
export const mockRbacRepository = new MockRbacRepository();
