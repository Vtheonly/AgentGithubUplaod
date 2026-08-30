// ============================================================================
// _shared/role-assignment.ts — SEC-107 role-override decision core
// ============================================================================
// Pure, Deno-free decision logic for "may THIS caller assign THAT role to
// the approved user?" — extracted so it can be unit-tested without Deno
// (same technique as _shared/cron-auth.ts for SEC-105 / T-004).
//
// SEC-107: the approve-signup-request Edge Function requires only
// support_staff to call, but its `assign_role` body parameter used to
// accept ANY role code — including super_admin — letting a support_staff
// caller escalate themselves or others during an approval.
//
// Rule (T-008):
//   - staff/admin roles (roles.is_staff_role = true — super_admin,
//     support_staff, manager, teacher, financial_officer, worker,
//     driver, buyer, warehouse_worker) may ONLY be assigned by a
//     super_admin caller.
//   - non-staff (web) roles (parent, student) may be assigned by any
//     caller already authorised to approve (support_staff or better).
//   - unknown role codes are rejected by the EF before consulting this
//     rule (the roles table lookup fails).
// ============================================================================

/** Shape of the role row the EF fetches from `public.roles`. */
export interface TargetRole {
  code: string;
  is_staff_role: boolean;
}

/** Verdicts returned by canAssignRole. */
export type RoleAssignmentVerdict = "allowed" | "forbidden_staff_role";

/**
 * Decide whether `callerRoles` (the caller's role codes, per
 * extractAuthContext) may assign `targetRole` to the approved user.
 */
export function canAssignRole(
  callerRoles: string[],
  targetRole: TargetRole | null | undefined,
): RoleAssignmentVerdict {
  if (!targetRole) return "forbidden_staff_role";
  if (!targetRole.is_staff_role) return "allowed"; // parent / student
  return callerRoles.includes("super_admin") ? "allowed" : "forbidden_staff_role";
}
