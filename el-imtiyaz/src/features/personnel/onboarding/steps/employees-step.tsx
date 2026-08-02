import { Users } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Button } from "../../../../shared/ui/button";
import { Card, CardContent } from "../../../../shared/ui/card";
import { Input } from "../../../../shared/ui/input";
import { Label } from "../../../../shared/ui/label";
import { StepHeader } from "./step-header";

export function EmployeesStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;

  async function setCount(count: number) {
    await repos.onboarding.updateData({ employeeCount: Math.max(0, count) });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Users}
        title="Combien d'employés compte votre organisation ?"
        description="Cette estimation est utilisée pour dimensionner les tableaux de bord et les rapports. Elle peut être ajustée à tout moment."
      />
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <Label htmlFor="emp-count">Nombre approximatif d'employés</Label>
            <Input
              id="emp-count"
              type="number"
              min={0}
              value={state.data.employeeCount}
              onChange={(e) => setCount(parseInt(e.target.value) || 0)}
              className="mt-1.5 max-w-xs"
            />
          </div>
          <div className="grid grid-cols-4 gap-2 max-w-md">
            {[10, 25, 50, 100].map((n) => (
              <Button
                key={n}
                variant="outline"
                size="sm"
                onClick={() => setCount(n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Astuce : vous pourrez ajouter des employés individuellement depuis le tableau de bord administrateur.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
