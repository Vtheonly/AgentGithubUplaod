import { CheckCircle2 } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { Role, ROLE_LABELS_FR } from "../../../../core/rbac/roles";
import {
  SHIFT_TYPE_LABELS_FR,
  type ShiftType,
} from "../../../../domain/model/workforce";
import { StepHeader } from "./step-header";

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export function ReviewStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;
  const d = state.data;

  return (
    <div className="space-y-4">
      <StepHeader
        icon={CheckCircle2}
        title="Vérification finale"
        description="Vérifiez la configuration avant de terminer. Vous pourrez tout modifier ultérieurement."
      />
      <Card>
        <CardContent className="p-5 space-y-4">
          <ReviewRow label="Départements" value={`${d.departments.length} département(s)`} />
          <ReviewRow
            label="Rôles activés"
            value={d.roles.map((r) => ROLE_LABELS_FR[r.role as Role]).join(", ") || "—"}
          />
          <ReviewRow label="Effectif estimé" value={`${d.employeeCount} employé(s)`} />
          <ReviewRow label="Administrateurs" value={`${d.adminIds.length} admin(s)`} />
          <ReviewRow label="Affectations responsables" value={`${d.managerAssignments.length} affectation(s)`} />
          <ReviewRow
            label="Horaires"
            value={`${d.workingHours.start} – ${d.workingHours.end}, ${d.workingHours.weekdays.length} jour(s)`}
          />
          <ReviewRow
            label="Types de poste"
            value={d.shiftTypes.map((t) => SHIFT_TYPE_LABELS_FR[t as ShiftType]).join(", ") || "—"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
