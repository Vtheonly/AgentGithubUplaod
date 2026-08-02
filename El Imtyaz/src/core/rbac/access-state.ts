/**
 * AccessState — the evaluated state of a feature node against a session.
 *
 * Three states: Enabled (render normally), Disabled (render at 40% alpha with
 * lock icon, clicks ignored), Hidden (not rendered at all — for cases where
 * existence of the feature would leak information).
 */
import type { Permission } from "./permissions";
import type { Role } from "./roles";

export type AccessState =
  | { kind: "enabled" }
  | { kind: "disabled"; reason: DisableReason }
  | { kind: "hidden" };

export type DisableReason =
  | { kind: "not_authenticated" }
  | { kind: "missing_permission"; permission: Permission }
  | { kind: "missing_role"; roles: Role[] }
  | { kind: "feature_flag_off"; flag: string }
  | { kind: "permanent"; state: PermanentState };

export type PermanentState =
  | "removed"
  | "not_yet_available"
  | "desktop_only"
  | "plan_upgrade_required";

export const PERMANENT_STATE_LABELS_FR: Record<PermanentState, string> = {
  removed: "Fonctionnalité retirée",
  not_yet_available: "Bientôt disponible",
  desktop_only: "Disponible sur le terminal de bureau",
  plan_upgrade_required: "Plan supérieur requis",
};

export function isEnabled(s: AccessState): s is { kind: "enabled" } {
  return s.kind === "enabled";
}

export function isDisabled(s: AccessState): s is { kind: "disabled"; reason: DisableReason } {
  return s.kind === "disabled";
}

export function isHidden(s: AccessState): s is { kind: "hidden" } {
  return s.kind === "hidden";
}
