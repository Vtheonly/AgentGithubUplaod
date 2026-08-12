import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { cn } from "../../../../shared/ui/cn";
import { ROLE_LABELS_FR } from "../../../../core/rbac/roles";
import { StepHeader } from "./step-header";

export function AdminsStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  if (!state) return null;

  async function toggle(id: string) {
    const admins = state!.data.adminIds.includes(id)
      ? state!.data.adminIds.filter((a) => a !== id)
      : [...state!.data.adminIds, id];
    await repos.onboarding.updateData({ adminIds: admins });
  }

  const candidates = personnel.filter((p) =>
    p.roleId === "super_admin" || p.roleId === "manager" || p.roleId === "financial_officer",
  );

  return (
    <div className="space-y-4">
      <StepHeader
        icon={ShieldCheck}
        title="Qui sont les administrateurs ?"
        description="Sélectionnez les employés qui auront un accès administrateur. Les administrateurs peuvent gérer l'ensemble de l'organisation."
      />
      <Card>
        <CardContent className="p-5">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun candidat. Ajoutez d'abord des employés avec un rôle administratif.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((p) => {
                const checked = state.data.adminIds.includes(p.id);
                return (
                  <li key={p.id} className="py-2.5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      className={cn(
                        "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors",
                        checked ? "border-primary bg-primary" : "border-muted-foreground/30",
                      )}
                    >
                      {checked && <CheckCircle2 className="h-3 w-3 text-popover" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS_FR[p.roleId]} • {p.position}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
