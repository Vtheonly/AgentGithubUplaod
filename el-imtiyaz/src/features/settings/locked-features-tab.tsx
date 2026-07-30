/**
 * LockedFeaturesTab — Settings → Fonctionnalités verrouillées
 *
 * Lists modules that were intentionally removed, reserved for desktop, or
 * pending implementation. This is read-only by design.
 *
 * Iteration 16: extracted from settings-page.tsx so each Settings tab
 * lives in its own file.
 */
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { StatusChip } from "../../shared/ui/status-chip";
import { PERMANENTLY_DISABLED } from "../../core/rbac/feature-registry";
import { PERMANENT_STATE_LABELS_FR } from "../../core/rbac/access-state";

export function LockedFeaturesTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fonctionnalités verrouillées</CardTitle>
        <CardDescription>
          Modules intentionnellement retirés, réservés au desktop, ou en attente d'implémentation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {PERMANENTLY_DISABLED.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-md border border-border p-3"
              style={{ opacity: 0.55 }}
            >
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{f.label}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{f.id}</p>
              </div>
              <StatusChip
                label={PERMANENT_STATE_LABELS_FR[f.state]}
                tone={f.state === "removed" ? "danger" : f.state === "desktop_only" ? "info" : "warning"}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
