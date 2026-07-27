/**
 * FeatureGate — pure evaluator: given a Session + FeatureFlagProvider +
 * AccessRequirement, returns an AccessState.
 *
 * Evaluation order (mirrors Android FeatureGate.kt):
 *   1. requirement.isEmpty        → Enabled
 *   2. requirement.permanent      → Disabled(Permanent)
 *   3. session == null            → Disabled(NotAuthenticated) or Hidden
 *   4. featureFlag off            → Disabled(FeatureFlagOff)
 *   5. permission not held        → Disabled(MissingPermission)
 *   6. role not matched           → Disabled(MissingRole)
 *   7. allOf missing any          → Disabled(MissingPermission)
 *   8. anyOf none held            → Disabled(MissingPermission)
 *   9. otherwise                  → Enabled
 *
 * Pure function — safe to call from any context, no side effects.
 */
import type { Session } from "./session";
import type { AccessRequirement } from "./access-requirement";
import type { AccessState, DisableReason } from "./access-state";

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
