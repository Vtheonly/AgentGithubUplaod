// ============================================================================
// FILE: src/features/dashboard/components/analytics/cross-risk-card.tsx
// ============================================================================
/**
 * Cross-Domain Risk Matrix Card.
 *
 * Provides a clear visual triage of operational vulnerabilities:
 *   - Triple Risque (Urgent)
 *   - Décrochage Académique
 *   - Absentéisme Non Justifié
 *   - Tension Financière
 */

import { AlertTriangle, TrendingDown, Clock, Wallet, Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../../shared/ui/card";
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
    academic: profiles.filter((p) => p.riskCategory === "academic_alert").length,
    attendance: profiles.filter((p) => p.riskCategory === "attendance_alert").length,
    financial: profiles.filter((p) => p.riskCategory === "financial_tension").length,
  };

  const handleLaunchEmergencyInvestigation = () => {
    const prompt =
      `Je lance un audit d'urgence sur les vulnérabilités de l'établissement :\n` +
      `- ${counts.triple} élève(s) en Triple Risque critique\n` +
      `- ${counts.academic} élève(s) en échec scolaire (GPA < 10)\n` +
      `- ${counts.attendance} élève(s) en alerte d'assiduité\n` +
      `- ${counts.financial} famille(s) en tension financière élevée\n\n` +
      `Construis un plan de remédiation complet avec priorisation P1/P2/P3 et actions concrètes pour la direction.`;

    openCopilot(true);
    void askAgent(prompt);
  };

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col justify-between">
      <CardHeader className="py-2.5 px-4 border-b border-border/50 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-status-warning" />
            Triage & Vulnérabilités Croisées
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Élèves identifiés selon les 4 catégories de vigilance opérationnelle
          </CardDescription>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={handleLaunchEmergencyInvestigation}
          className="h-7 text-xs border-primary/30 text-primary gap-1"
        >
          <Bot className="h-3 w-3" /> Audit IA d'Urgence
        </Button>
      </CardHeader>

      <CardContent className="p-4 space-y-3 flex-1">
        <div className="grid grid-cols-2 gap-3">
          {/* 1. Triple Risque */}
          <div
            onClick={() => onSelectCategory?.("triple_critical")}
            className="p-3 rounded-lg border border-status-danger/40 bg-status-danger/10 cursor-pointer hover:bg-status-danger/15 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-status-danger">Triple Risque</span>
              <AlertTriangle className="h-4 w-4 text-status-danger" />
            </div>
            <div className="text-2xl font-mono font-bold text-status-danger mt-1">
              {counts.triple}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Notes + Absences + Dette</p>
          </div>

          {/* 2. Échec scolaire */}
          <div
            onClick={() => onSelectCategory?.("academic_alert")}
            className="p-3 rounded-lg border border-status-warning/40 bg-status-warning/10 cursor-pointer hover:bg-status-warning/15 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-status-warning">Alerte Moyenne</span>
              <TrendingDown className="h-4 w-4 text-status-warning" />
            </div>
            <div className="text-2xl font-mono font-bold text-status-warning mt-1">
              {counts.academic}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">GPA &lt; 10 / 20</p>
          </div>

          {/* 3. Décrochage Présence */}
          <div
            onClick={() => onSelectCategory?.("attendance_alert")}
            className="p-3 rounded-lg border border-border bg-surface-elevated/40 cursor-pointer hover:bg-surface-elevated/80 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">Absences</span>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-mono font-bold text-foreground mt-1">
              {counts.attendance}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">≥ 3 absences injustifiées</p>
          </div>

          {/* 4. Retards de paiement */}
          <div
            onClick={() => onSelectCategory?.("financial_tension")}
            className="p-3 rounded-lg border border-border bg-surface-elevated/40 cursor-pointer hover:bg-surface-elevated/80 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">Dette Élevée</span>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-mono font-bold text-foreground mt-1">
              {counts.financial}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Solde dû &gt; 25 000 DA</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground pt-1">
          Cliquez sur un quadrant pour filtrer immédiatement la console d'investigation.
        </p>
      </CardContent>
    </Card>
  );
}