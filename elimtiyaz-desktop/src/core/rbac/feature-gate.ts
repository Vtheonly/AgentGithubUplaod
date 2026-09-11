// ============================================================================
// FILE: src/core/rbac/feature-gate.ts
// ============================================================================
import type { Session } from "./session";
import { isSuperAdmin } from "./session";
import type { AccessRequirement } from "./access-requirement";
import type { AccessState } from "./access-state";

export interface FeatureFlagProvider {
  isEnabled(flag: string): boolean;
}

export const alwaysOnFlagProvider: FeatureFlagProvider = {
  isEnabled: () => true,
};

export function evaluate(
  requirement: AccessRequirement,
  ctx: { session: Session | null; flags: FeatureFlagProvider },
): AccessState {
  if (requirement.kind === "empty") return { kind: "enabled" };
  if (requirement.kind === "permanent") {
    return { kind: "disabled", reason: { kind: "permanent", state: requirement.state } };
  }

  if (ctx.session === null) {
    if (requirement.hideWhenUnauthenticated) return { kind: "hidden" };
    return { kind: "disabled", reason: { kind: "not_authenticated" } };
  }

  const { session } = ctx;

  // SuperAdmin has unconditional access to all features
  if (isSuperAdmin(session)) {
    return { kind: "enabled" };
  }

  switch (requirement.kind) {
    case "permission":
      if (!session.permissions.has(requirement.permission)) {
        return {
          kind: "disabled",
          reason: { kind: "missing_permission", permission: requirement.permission },
        };
      }
      return { kind: "enabled" };

    case "anyOfPermission":
      if (!requirement.permissions.some((p) => session.permissions.has(p))) {
        return {
          kind: "disabled",
          reason: { kind: "missing_permission", permission: requirement.permissions[0] },
        };
      }
      return { kind: "enabled" };

    case "allOfPermission": {
      const missing = requirement.permissions.find((p) => !session.permissions.has(p));
      if (missing) {
        return {
          kind: "disabled",
          reason: { kind: "missing_permission", permission: missing },
        };
      }
      return { kind: "enabled" };
    }

    case "role":
      if (!requirement.roles.includes(session.role)) {
        return { kind: "disabled", reason: { kind: "missing_role", roles: requirement.roles } };
      }
      return { kind: "enabled" };
  }
}