/**
 * AccessRequirement — declarative spec for what is needed to access a feature.
 *
 * A requirement is one of:
 *   - empty           → enabled for everyone (no constraints)
 *   - permanent       → permanently disabled with a state (removed / desktop-only / etc.)
 *   - permission      → requires a single permission
 *   - anyOfPermission → requires at least one of N permissions
 *   - allOfPermission → requires all of N permissions
 *   - role            → requires one of N roles
 *
 * The FeatureGate evaluates requirements in priority order. See feature-gate.ts.
 */
import type { Permission } from "./permissions";
import type { Role } from "./roles";
import type { PermanentState } from "./access-state";

export type AccessRequirement =
  | { kind: "empty" }
  | { kind: "permanent"; state: PermanentState }
  | { kind: "permission"; permission: Permission; hideWhenUnauthenticated?: boolean }
  | { kind: "anyOfPermission"; permissions: Permission[]; hideWhenUnauthenticated?: boolean }
  | { kind: "allOfPermission"; permissions: Permission[]; hideWhenUnauthenticated?: boolean }
  | { kind: "role"; roles: Role[]; hideWhenUnauthenticated?: boolean };

export const empty: AccessRequirement = { kind: "empty" };

export const permanent = (state: PermanentState): AccessRequirement => ({ kind: "permanent", state });

export const requiresPermission = (
  permission: Permission,
  opts: { hideWhenUnauthenticated?: boolean } = {},
): AccessRequirement => ({ kind: "permission", permission, ...opts });

export const requiresAnyOf = (
  permissions: Permission[],
  opts: { hideWhenUnauthenticated?: boolean } = {},
): AccessRequirement => ({ kind: "anyOfPermission", permissions, ...opts });

export const requiresAllOf = (
  permissions: Permission[],
  opts: { hideWhenUnauthenticated?: boolean } = {},
): AccessRequirement => ({ kind: "allOfPermission", permissions, ...opts });

export const requiresRole = (
  roles: Role[],
  opts: { hideWhenUnauthenticated?: boolean } = {},
): AccessRequirement => ({ kind: "role", roles, ...opts });
