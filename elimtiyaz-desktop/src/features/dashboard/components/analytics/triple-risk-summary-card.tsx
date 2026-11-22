/**
 * TripleRiskSummaryCard — E6.8 (UI-U7b / DUP-027): extracted verbatim from the
 * former executive-cards.tsx monolith (1,098 L) into its own module;
 * the barrel re-exports it so import sites are unchanged.
 */
// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/executive-cards.tsx
// ============================================================================

import { useMemo, type ReactNode } from "react";
import {
  Waves,
  Percent,
  PhoneCall,
  Users,
  Bus,
  Stethoscope,
  Scale,
  Radar,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { ExecutiveCard } from "./executive-card";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import { formatDueDateRange } from "../../../../core/format/date";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../../../domain/model/payment";
import { personDisplayName } from "../../../../domain/model/person";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import type { Parent } from "../../../../domain/model/parent";
import {
  deriveDiscountErosion,
  deriveServiceYield,
  deriveTripleRiskSummary,
  daysBetweenFloor,
  type TrancheWave,
  type DebtTriage,
  type FamilyConcentration,
  type FamilyExposure,
  type TransportYield,
  type EnrollmentDynamics,
} from "./executive-statistics";
import type { StudentRiskProfile } from "./operational-query-engine";
import { InfoTip } from "./info-tip";
import { CardHeaderActions } from "./card-header-actions";
import {
  ReferencePopulationSelector,
  type ReferencePopulationMode,
} from "./reference-population-selector";
import { useState } from "react";
import {
  emptyPooledWave,
  type PooledTrancheWave,
  type NonWaveCategoryStats,
} from "../../../../domain/calc/payment/tranche-waves";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../../domain/model/parent";

export function TripleRiskSummaryCard({
  summary,
  profiles,
  headerActions,
}: {
  summary: ReturnType<typeof deriveTripleRiskSummary>;
  profiles: readonly StudentRiskProfile[];
  headerActions?: ReactNode;
}) {
  const tripleCount = summary.tripleCriticalCount;

  return (
    <ExecutiveCard
      testId="triple-risk-summary-card"
      shellClassName={
        tripleCount > 0
          ? "border-status-danger/40 bg-gradient-to-br from-status-danger/10 via-surface-panel to-surface-panel"
          : "border-border/80"
      }
      icon={<Radar className="h-4 w-4 text-status-danger" />}
      title="Radar de Vigilance Multi-Critères"
      infoTip="risk.card"
      description="Corrélation directe : Notes + Assiduité + Créance financière"
      headerActions={headerActions}
      contentClassName="p-4 space-y-3.5 flex-1 flex flex-col justify-between"
    >
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-3xl font-bold font-mono text-status-danger tabular-nums">
            {tripleCount}
          </span>
          <span className="text-xs text-muted-foreground block mt-0.5">
            élèves cumulant le triple risque critique
          </span>
        </div>
        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-status-danger/20 text-status-danger border border-status-danger/30">
          {summary.tripleCriticalPct}% cohorte
        </span>
      </div>

      <div
        className="grid grid-cols-3 gap-2 text-center text-xs"
        data-testid="triple-risk-counts"
      >
        <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
          <span className="text-[10px] text-muted-foreground block flex items-center gap-0.5">
            Moyenne &lt; 10
            <InfoTip tip="risk.academic" size={10} className="shrink-0" />
          </span>
          <span className="text-sm font-bold font-mono text-status-warning">
            {summary.academicAlertCount}
          </span>
        </div>
        <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
          <span className="text-[10px] text-muted-foreground block flex items-center gap-0.5">
            Absences ≥ 3
            <InfoTip tip="risk.attendance" size={10} className="shrink-0" />
          </span>
          <span className="text-sm font-bold font-mono text-status-warning">
            {summary.attendanceAlertCount}
          </span>
        </div>
        <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
          <span className="text-[10px] text-muted-foreground block flex items-center gap-0.5">
            Dette ouverte
            <InfoTip tip="risk.financial" size={10} className="shrink-0" />
          </span>
          <span className="text-sm font-bold font-mono text-status-danger">
            {summary.financialTensionCount}
          </span>
        </div>
      </div>
    </ExecutiveCard>
  );
}
