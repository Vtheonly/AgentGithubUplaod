import { Briefcase } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { cn } from "../../../../shared/ui/cn";
import { Role, ROLE_LABELS_FR, ROLE_DESCRIPTIONS_FR, STAFF_ROLES } from "../../../../core/rbac/roles";
import { StepHeader } from "./step-header";

export function RolesStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;
  const selected = new Set(state.data.roles.map((r) => r.role));

  async function toggle(role: Role) {
    const roles = selected.has(role)
      ? state!.data.roles.filter((r) => r.role !== role)
      : [...state!.data.roles, { role, count: 0 }];
    await repos.onboarding.updateData({ roles });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Briefcase}
        title="Quels rôles existent dans votre organisation ?"
        description="Sélectionnez les rôles que vous souhaitez activer. Les permissions par défaut seront appliquées; vous pourrez les affiner à l'étape suivante."
      />
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {Array.from(STAFF_ROLES).map((role) => {
              const checked = selected.has(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggle(role)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent/5",
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 mt-0.5 rounded-full border-2",
                    checked ? "border-primary bg-primary" : "border-muted-foreground/30",
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{ROLE_LABELS_FR[role]}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {ROLE_DESCRIPTIONS_FR[role]}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
