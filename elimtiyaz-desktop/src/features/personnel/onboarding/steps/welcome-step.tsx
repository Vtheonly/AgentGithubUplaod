import { Building2, Users, CalendarClock, Sparkles } from "lucide-react";
import { Card, CardContent } from "../../../../shared/ui/card";

export function WelcomeStep() {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-4">
        <div className="h-16 w-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Bienvenue dans El-Imtiyaz</h2>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Cet assistant vous guide à travers la configuration initiale de votre organisation.
          Vous allez définir vos départements, vos rôles, vos horaires de travail et vos
          permissions. Cette configuration peut être modifiée ultérieurement depuis les
          Paramètres.
        </p>
        <div className="grid grid-cols-3 gap-3 max-w-2xl mx-auto pt-4">
          <div className="rounded-lg border border-border p-3">
            <Building2 className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Départements</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <Users className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Employés</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <CalendarClock className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Horaires</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
