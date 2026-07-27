/**
 * GatedContent — declarative RBAC wrapper. Pass a FeatureNode and children;
 * the wrapper evaluates the requirement against the current Session and
 * renders the children (or a locked / hidden state) accordingly.
 */
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { FeatureNode } from "../../core/rbac/feature-registry";
import { evaluate } from "../../core/rbac/feature-gate";
import { alwaysOnFlagProvider } from "../../core/rbac/feature-gate";
import { PERMANENT_STATE_LABELS_FR } from "../../core/rbac/access-state";
import { useAuth } from "../../state/auth-context";
import { cn } from "../ui/cn";

interface GatedContentProps {
  node: FeatureNode;
  children: ReactNode;
  disabledStyle?: "overlay" | "inline" | "placeholder";
  className?: string;
}

export function GatedContent({ node, children, disabledStyle = "overlay", className }: GatedContentProps) {
  const { session } = useAuth();
  const state = evaluate(node.requirement, { session, flags: alwaysOnFlagProvider });

  if (state.kind === "enabled") {
    return <>{children}</>;
  }

  if (state.kind === "hidden") {
    return null;
  }

  // Disabled — render with reduced opacity + lock icon overlay.
  if (disabledStyle === "overlay") {
    return (
      <div className={cn("relative", className)} style={{ opacity: 0.5 }}>
        <div className="pointer-events-none">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 rounded-md bg-popover/80 px-4 py-2 backdrop-blur-sm">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{labelFor(state.reason)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (disabledStyle === "inline") {
    return (
      <div className={cn("flex items-center gap-2 text-muted-foreground", className)}>
        <Lock className="h-4 w-4" />
        <span className="text-sm">{labelFor(state.reason)}</span>
      </div>
    );
  }

  // placeholder
  return (
    <div className={cn("flex h-full items-center justify-center text-muted-foreground", className)}>
      <Lock className="h-4 w-4 mr-2" />
      {labelFor(state.reason)}
    </div>
  );
}

function labelFor(reason: import("../../core/rbac/access-state").DisableReason): string {
  switch (reason.kind) {
    case "not_authenticated":
      return "Connexion requise";
    case "missing_permission":
      return "Permission insuffisante";
    case "missing_role":
      return "Rôle insuffisant";
    case "feature_flag_off":
      return "Fonctionnalité désactivée";
    case "permanent":
      return PERMANENT_STATE_LABELS_FR[reason.state];
  }
}

/** Convenience hook: returns the AccessState for a feature node. */
export function useAccessState(node: FeatureNode) {
  const { session } = useAuth();
  return evaluate(node.requirement, { session, flags: alwaysOnFlagProvider });
}
