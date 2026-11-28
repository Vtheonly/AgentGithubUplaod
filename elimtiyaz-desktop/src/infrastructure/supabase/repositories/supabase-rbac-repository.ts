/**
 * SupabaseRbacRepository — the tenant-level RBAC matrix persistence
 * (T-588 / BUG-017 / SET-U5, migration 0006).
 *
 * RPC CONTRACT (all three resolve the caller's identity + tenant
 * SERVER-SIDE from the JWT — the client never sends identity columns):
 *   - read_rbac_effective_matrix() → { [role_code]: [perm codes] } — the
 *     deny-wins effective matrix the server actually enforces. Codes with
 *     no desktop-enum counterpart (the legacy catalog vocabulary) surface
 *     via `unmappedServerCodes` so the editor can show an honest count
 *     without pretending to manage them.
 *   - save_rbac_matrix(p_matrix) — the transactional diff-write. The
 *     payload lists, per staff role, the FULL granted/denied vocabulary of
 *     the desktop enum; the RPC writes only the cells that differ from the
 *     role_permissions defaults (unlisted/legacy codes untouched).
 *   - reset_rbac_matrix() — clears the tenant's override set.
 *
 * ERROR MODEL: every failure propagates as an Err (fail-loud — the
 * BUSINESS-002 lesson); the editor decides the degradation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RbacRepository,
  RbacMatrixSnapshot,
} from "../../../domain/repository/rbac-repository";
import type {
  RbacMatrixSaveResult,
  RbacMatrixResetResult,
} from "../../../domain/model/rbac";
import { Ok, Err, type Result } from "../../../core/result";
import { supabaseErrorToAppError } from "../supabase-client";
import { Role, STAFF_ROLES } from "../../../core/rbac/roles";
import { Permission } from "../../../core/rbac/permissions";
import { mapRoleCode, mapPermissionCodes } from "./supabase-auth-repository";

/** Enum member → DB code. The Permission enum's VALUES are already the
 * DB snake_case codes ("view_roster" …) — the identity, NOT a transform
 * (mapPermissionCodes' PascalCase round-trip handles the other direction). */
function permissionToCode(p: Permission): string {
  return p as string;
}

export class SupabaseRbacRepository implements RbacRepository {
  constructor(private readonly client: SupabaseClient) {}

  async loadEffectiveMatrix(): Promise<Result<RbacMatrixSnapshot>> {
    try {
      const { data, error } = await this.client.rpc("read_rbac_effective_matrix");
      if (error) return Err(supabaseErrorToAppError(error));
      if (!data || typeof data !== "object") {
        return Err(supabaseErrorToAppError({ message: "read_rbac_effective_matrix: réponse invalide" }));
      }

      const raw = data as Record<string, string[]>;
      const matrix = {} as Record<Role, Permission[]>;
      for (const role of STAFF_ROLES) {
        // role enum → the DB code (the shared mapper's inverse for staff roles)
        const code = roleToCode(role);
        const codes = Array.isArray(raw[code]) ? raw[code] : [];
        matrix[role] = Array.from(mapPermissionCodes(codes));
      }

      // Server-only codes (legacy vocabulary) — counted once, per role set.
      const known = new Set(Object.values(Permission).map(permissionToCode));
      const unmapped = new Set<string>();
      for (const codes of Object.values(raw)) {
        for (const code of codes ?? []) {
          if (!known.has(code)) unmapped.add(code);
        }
      }

      // The honest "Personnalisé" signal: does the tenant carry ANY override
      // row? (RLS tenant-scopes this count to the caller's tenant.)
      const { count, error: countError } = await this.client
        .from("tenant_role_overrides")
        .select("id", { count: "exact", head: true });
      if (countError) return Err(supabaseErrorToAppError(countError));

      return Ok({
        matrix,
        unmappedServerCodes: Array.from(unmapped).sort(),
        hasOverrides: (count ?? 0) > 0,
      });
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async saveMatrix(matrix: Record<Role, Permission[]>): Promise<Result<RbacMatrixSaveResult>> {
    try {
      // The payload covers the editor's WHOLE managed vocabulary per role:
      // granted = the checked cells, denied = the unchecked ones. Codes the
      // desktop enum does not model are NOT listed (the RPC leaves them
      // untouched — a save can never strip a legacy default grant).
      const allCodes = Object.values(Permission) as Permission[];
      const payload: Record<string, { granted: string[]; denied: string[] }> = {};
      for (const role of STAFF_ROLES) {
        const grantedSet = new Set(matrix[role] ?? []);
        payload[roleToCode(role)] = {
          granted: allCodes.filter((p) => grantedSet.has(p)).map(permissionToCode),
          denied: allCodes.filter((p) => !grantedSet.has(p)).map(permissionToCode),
        };
      }

      const { data, error } = await this.client.rpc("save_rbac_matrix", {
        p_matrix: payload,
      });
      if (error) return Err(supabaseErrorToAppError(error));
      const r = (data ?? {}) as { saved?: number; removed?: number };
      return Ok({ saved: r.saved ?? 0, removed: r.removed ?? 0 });
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async resetMatrix(): Promise<Result<RbacMatrixResetResult>> {
    try {
      const { data, error } = await this.client.rpc("reset_rbac_matrix");
      if (error) return Err(supabaseErrorToAppError(error));
      const r = (data ?? {}) as { removed?: number };
      return Ok({ removed: r.removed ?? 0 });
    } catch (err) {
      return Err(
        supabaseErrorToAppError({
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}

/** Role enum → DB code — DERIVED from the shared mapRoleCode (no second
 * mapping table to drift; the staff codes are the catalog's own values). */
const STAFF_ROLE_CODES = [
  "super_admin", "financial_officer", "teacher", "support_staff",
  "manager", "buyer", "driver", "warehouse_worker", "worker",
] as const;

function roleToCode(role: Role): string {
  return STAFF_ROLE_CODES.find((code) => mapRoleCode(code) === role) ?? "support_staff";
}
