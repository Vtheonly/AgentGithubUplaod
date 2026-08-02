import { useState } from "react";
import { Building2, CheckCircle2 } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Button } from "../../../../shared/ui/button";
import { Card, CardContent } from "../../../../shared/ui/card";
import { Input } from "../../../../shared/ui/input";
import { Label } from "../../../../shared/ui/label";
import { cn } from "../../../../shared/ui/cn";
import {
  DEFAULT_DEPARTMENTS,
  DEPARTMENT_COLOR_OPTIONS,
  type DepartmentColor,
} from "../../../../domain/model/workforce";
import { StepHeader } from "./step-header";

export function DepartmentsStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);
  const [customName, setCustomName] = useState("");
  const [customColor, setCustomColor] = useState<DepartmentColor>("brand-blue");

  if (!state) return null;
  const selected = state.data.departments;

  async function toggleDefault(name: string, color: DepartmentColor) {
    const exists = selected.find((d) => d.name === name);
    const next = exists
      ? selected.filter((d) => d.name !== name)
      : [...selected, { name, color, headId: null }];
    await repos.onboarding.updateData({ departments: next });
  }

  async function addCustom() {
    if (!customName.trim()) return;
    const next = [...selected, { name: customName.trim(), color: customColor, headId: null }];
    await repos.onboarding.updateData({ departments: next });
    setCustomName("");
  }

  async function removeCustom(name: string) {
    const next = selected.filter((d) => d.name !== name);
    await repos.onboarding.updateData({ departments: next });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Building2}
        title="Quels départements existent ?"
        description="Sélectionnez les départements qui composent votre organisation. Vous pouvez en ajouter de personnalisés."
      />
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {DEFAULT_DEPARTMENTS.map((d) => {
              const checked = selected.some((s) => s.name === d.name);
              return (
                <button
                  key={d.name}
                  type="button"
                  onClick={() => toggleDefault(d.name, d.color)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors",
                    checked
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent/5",
                  )}
                >
                  <div className={cn("h-8 w-8 rounded-md flex items-center justify-center", `bg-${d.color}/15`)}>
                    <Building2 className={cn("h-4 w-4", `text-${d.color}`)} />
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground">{d.name}</span>
                  {checked && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>

          <div className="border-t border-border pt-4">
            <Label className="text-xs text-muted-foreground">Ajouter un département personnalisé</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Nom du département"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
              />
              <select
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value as DepartmentColor)}
                className="h-9 rounded-md border border-border bg-popover px-2 text-sm"
              >
                {DEPARTMENT_COLOR_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Button size="sm" onClick={addCustom} disabled={!customName.trim()}>
                Ajouter
              </Button>
            </div>
          </div>

          {selected.length > 0 && (
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-2">
                {selected.length} département{selected.length > 1 ? "s" : ""} sélectionné{selected.length > 1 ? "s" : ""}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selected.map((d) => (
                  <span
                    key={d.name}
                    className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-xs"
                  >
                    {d.name}
                    <button
                      type="button"
                      onClick={() => removeCustom(d.name)}
                      className="text-muted-foreground hover:text-status-danger"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
