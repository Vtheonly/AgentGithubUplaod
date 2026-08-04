import { Layers } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { cn } from "../../../../shared/ui/cn";
import {
  SHIFT_TYPE_LABELS_FR,
  type ShiftType,
} from "../../../../domain/model/workforce";
import { ALL_SHIFT_TYPES } from "./shared";
import { StepHeader } from "./step-header";

export function ShiftTypesStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;

  async function toggle(type: ShiftType) {
    const set = new Set(state!.data.shiftTypes);
    if (set.has(type)) set.delete(type);
    else set.add(type);
    await repos.onboarding.updateData({ shiftTypes: Array.from(set) });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Layers}
        title="Quels types de poste existent ?"
        description="Sélectionnez les types de poste (shifts) que votre organisation utilise. Ces types seront disponibles dans le gestionnaire de plannings."
      />
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
            {ALL_SHIFT_TYPES.map((type) => {
              const checked = state.data.shiftTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggle(type)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors",
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent/5",
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded-full border-2",
                    checked ? "border-primary bg-primary" : "border-muted-foreground/30",
                  )} />
                  <span className="text-sm font-medium text-foreground">
                    {SHIFT_TYPE_LABELS_FR[type]}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
