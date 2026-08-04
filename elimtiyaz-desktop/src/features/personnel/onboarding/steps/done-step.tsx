import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "../../../../shared/ui/card";

export function DoneStep() {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-4">
        <div className="h-16 w-16 mx-auto rounded-full bg-status-success/15 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-status-success" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Configuration terminée !</h2>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Votre organisation est prête. Vous pouvez maintenant accéder à votre tableau de bord
          personnalisé et commencer à gérer vos employés, vos tâches et vos communications.
        </p>
      </CardContent>
    </Card>
  );
}
