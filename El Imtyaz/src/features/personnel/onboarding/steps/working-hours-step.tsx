import { CalendarClock } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { Input } from "../../../../shared/ui/input";
import { Label } from "../../../../shared/ui/label";
import { cn } from "../../../../shared/ui/cn";
import {
  WEEKDAYS,
  WEEKDAY_LABELS_FR,
  type Weekday,
} from "../../../../domain/model/workforce";
import { StepHeader } from "./step-header";

export function WorkingHoursStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;
  const wh = state.data.workingHours;

  async function setStart(start: string) {
    await repos.onboarding.updateData({ workingHours: { ...state!.data.workingHours, start } });
  }
  async function setEnd(end: string) {
    await repos.onboarding.updateData({ workingHours: { ...state!.data.workingHours, end } });
  }
  async function toggleWeekday(day: Weekday) {
    const set = new Set(wh.weekdays as readonly string[]);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    await repos.onboarding.updateData({
      workingHours: { ...state!.data.workingHours, weekdays: Array.from(set) },
    });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={CalendarClock}
        title="Quels sont les horaires de travail ?"
        description="Définissez les heures de travail standard et les jours ouvrés. Ces valeurs seront utilisées pour les plannings et le calcul des heures."
      />
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <Label htmlFor="wh-start">Heure de début</Label>
              <Input
                id="wh-start"
                type="time"
                value={wh.start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="wh-end">Heure de fin</Label>
              <Input
                id="wh-end"
                type="time"
                value={wh.end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Jours ouvrés</Label>
            <div className="grid grid-cols-7 gap-2 mt-2 max-w-2xl">
              {WEEKDAYS.map((day) => {
                const checked = wh.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWeekday(day)}
                    className={cn(
                      "rounded-md border p-2 text-xs font-medium transition-colors",
                      checked
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent/5",
                    )}
                  >
                    {WEEKDAY_LABELS_FR[day].slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
