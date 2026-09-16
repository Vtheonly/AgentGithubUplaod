// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/cross-risk-card.tsx
// ============================================================================

import { AlertTriangle, TrendingDown, Clock, Wallet, Bot } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { Button } from "../../../../shared/ui/button";
import { useAICopilot } from "../../../../app/providers/ai-copilot-provider";
import type { StudentRiskProfile } from "./operational-query-engine";

interface Props {
  profiles: StudentRiskProfile[];
  onSelectCategory?: (category: string) => void;
}

export function CrossRiskCard({ profiles, onSelectCategory }: Props) {
  const { askAgent, setIsOpen: openCopilot } = useAICopilot();

  const counts = {
    triple: profiles.filter((p) => p.riskCategory === "triple_critical").length,
    academic: profiles.filter((p) => p.riskCategory === "academic_alert")
      .length,
    attendance: profiles.filter((p) => p.riskCategory === "attendance_alert")
      .length,
    financial: profiles.filter((p) => p.riskCategory === "financial_tension")
      .length,
  };

  const handleLaunchEmergencyInvestigation = () => {
    const prompt =
      `Audit d'urgence sur les vulnérabilités de l'établissement :\n` +
      `- ${counts.triple} élève(s) en Triple Risque critique\n` +
      `- ${counts.academic} élève(s) en difficulté académique (GPA < 10)\n` +
      `- ${counts.attendance} élève(s) en alerte assiduité\n` +
      `- ${counts.financial} famille(s) en tension financière élevée\n\n` +
      `Construis un plan de remédiation opérationnel avec priorisation et actions immédiates.`;

    openCopilot(true);
    void askAgent(prompt);
  };

  return (
    <Card className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between">
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-warning" />
            Triage des Vulnérabilités Croisées
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Distribution selon les 4 axes de vigilance opérationnelle
          </CardDescription>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={handleLaunchEmergencyInvestigation}
          className="h-7 text-xs border-primary/40 text-primary gap-1.5"
        >
          <Bot className="h-3.5 w-3.5" />
          Audit IA
        </Button>
      </CardHeader>

      <CardContent className="p-4 space-y-3 flex-1 flex flex-col justify-between">
        <div className="grid grid-cols-2 gap-3">
          {/* 1. Triple Risque */}
          <div
            onClick={() => onSelectCategory?.("triple_critical")}
            className="p-3.5 rounded-xl border border-status-danger/40 bg-status-danger/10 cursor-pointer hover:bg-status-danger/15 transition-all space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-status-danger">
                Triple Risque
              </span>
              <AlertTriangle className="h-4 w-4 text-status-danger" />
            </div>
            <div className="text-2xl font-mono font-bold text-status-danger">
              {counts.triple}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Notes + Absences + Dette
            </p>
          </div>

          {/* 2. Échec scolaire */}
          <div
            onClick={() => onSelectCategory?.("academic_alert")}
            className="p-3.5 rounded-xl border border-status-warning/40 bg-status-warning/10 cursor-pointer hover:bg-status-warning/15 transition-all space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-status-warning">
                Moyenne &lt; 10
              </span>
              <TrendingDown className="h-4 w-4 text-status-warning" />
            </div>
            <div className="text-2xl font-mono font-bold text-status-warning">
              {counts.academic}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Décrochage pédagogique
            </p>
          </div>

          {/* 3. Assiduité */}
          <div
            onClick={() => onSelectCategory?.("attendance_alert")}
            className="p-3.5 rounded-xl border border-border/70 bg-surface-elevated/40 cursor-pointer hover:bg-surface-elevated/70 transition-all space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">
                Assiduité
              </span>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-mono font-bold text-foreground">
              {counts.attendance}
            </div>
            <p className="text-[10px] text-muted-foreground">
              ≥ 3 absences non justifiées
            </p>
          </div>

          {/* 4. Retards de paiement */}
          <div
            onClick={() => onSelectCategory?.("financial_tension")}
            className="p-3.5 rounded-xl border border-border/70 bg-surface-elevated/40 cursor-pointer hover:bg-surface-elevated/70 transition-all space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">
                Tension Dette
              </span>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-mono font-bold text-foreground">
              {counts.financial}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Solde dû &gt; 25 000 DA
            </p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          Cliquez sur un quadrant pour filtrer la console d'investigation.
        </p>
      </CardContent>
    </Card>
  );
}
