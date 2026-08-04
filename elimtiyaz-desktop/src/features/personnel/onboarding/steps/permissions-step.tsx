import { ShieldCheck } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { Role, ROLE_LABELS_FR } from "../../../../core/rbac/roles";
import { StepHeader } from "./step-header";

export function PermissionsStep() {
  const state = useObservable(() => useRepositories().onboarding.observe(), []);
  return (
    <div className="space-y-4">
      <StepHeader
        icon={ShieldCheck}
        title="Vérification des permissions"
        description="Les permissions par défaut ont été appliquées pour chaque rôle sélectionné. Vous pourrez les ajuster finement depuis Paramètres → Matrice RBAC une fois la configuration terminée."
      />
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Chaque rôle dispose d'un ensemble de permissions par défaut, conforme au plan de
            développement (§02.07 RBAC). Ces permissions contrôlent l'accès aux modules, aux
            actions et à la visibilité des données. La matrice complète est éditable dans
            Paramètres → Matrice RBAC.
          </p>
          <div className="mt-4 rounded-md bg-accent/5 border border-border p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Rôles activés :</strong>{" "}
            {state?.data.roles.map((r) => ROLE_LABELS_FR[r.role as Role]).join(", ") || "—"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
