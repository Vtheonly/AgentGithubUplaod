import { UserCog } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { StepHeader } from "./step-header";

export function ManagersStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  if (!state) return null;

  const managers = personnel.filter((p) => p.roleId === "manager" || p.roleId === "super_admin");

  async function assign(departmentName: string, managerId: string) {
    const existing = state!.data.managerAssignments.find((a) => a.departmentName === departmentName);
    const next = existing
      ? state!.data.managerAssignments.map((a) =>
          a.departmentName === departmentName ? { ...a, managerId } : a,
        )
      : [...state!.data.managerAssignments, { departmentName, managerId }];
    await repos.onboarding.updateData({ managerAssignments: next });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={UserCog}
        title="Qui gère chaque département ?"
        description="Affectez un responsable à chaque département. Les responsables supervisent leur équipe et approuvent les demandes."
      />
      <Card>
        <CardContent className="p-5">
          {state.data.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun département configuré. Retournez à l'étape Départements.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {state.data.departments.map((d) => {
                const assignment = state.data.managerAssignments.find((a) => a.departmentName === d.name);
                return (
                  <li key={d.name} className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{d.name}</p>
                    </div>
                    <select
                      value={assignment?.managerId ?? ""}
                      onChange={(e) => assign(d.name, e.target.value)}
                      className="h-9 rounded-md border border-border bg-popover px-2 text-sm max-w-xs"
                    >
                      <option value="">— Non assigné —</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.firstName} {m.lastName}
                        </option>
                      ))}
                    </select>
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
