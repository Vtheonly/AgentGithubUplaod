/**
 * Routing hub — driver mode. NOT in the plan; stubbed for parity with Android.
 *
 * If the user lacks AccessDriverMode permission, the sidebar entry renders
 * locked. If they reach this page directly without permission, an access
 * denied panel is shown.
 */
import { useTranslation } from "react-i18next";
import { Route as RouteIcon, Lock } from "lucide-react";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { ComingSoonCard } from "../../shared/layout/coming-soon-card";
import { useAccessState } from "../../shared/layout/gated-content";
import { Routing as RoutingNode } from "../../core/rbac/feature-registry";

export function RoutingPage() {
  const { t } = useTranslation();
  const state = useAccessState(RoutingNode);

  if (state.kind !== "enabled") {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title={t("nav.routing")} description="Mode conducteur — tournées et optimisation" />
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-status-danger/15">
                <Lock className="h-7 w-7 text-status-danger" />
              </div>
              <p className="text-sm font-medium text-foreground">Accès refusé</p>
              <p className="text-xs text-muted-foreground">
                Le mode conducteur est réservé aux chauffeurs affectés. Contactez un administrateur
                si vous pensez que c'est une erreur.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.routing")}
        description="Mode conducteur — tournées et optimisation d'itinéraire"
      />
      <div className="flex-1 px-6 pb-6">
        <ComingSoonCard
          title="Tournées & optimisation d'itinéraire"
          description="Liste des véhicules avec capacité, optimisation TSP (nearest-neighbor + 2-opt), intégration OSRM pour la géométrie réelle, suivi live de position."
        />
        <div className="mt-4 flex justify-center">
          <RouteIcon className="h-12 w-12 text-muted-foreground opacity-30" />
        </div>
      </div>
    </div>
  );
}
