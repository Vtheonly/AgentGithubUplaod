/**
 * DiscountErosionCard — E6.8 (UI-U7b / DUP-027): extracted verbatim from the
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

export function DiscountErosionCard({
  ledger,
  headerActions,
}: {
  ledger: readonly LedgerEntry[];
  headerActions?: ReactNode;
}) {
  const erosion = useMemo(() => deriveDiscountErosion(ledger), [ledger]);

  return (
    <ExecutiveCard
      testId="discount-erosion-card"
      icon={<Percent className="h-4 w-4 text-status-warning" />}
      title="Taux d'Érosion des Remises"
      infoTip="erosion.card"
      description={
        erosion.remiseCount > 0
          ? `${erosion.remiseCount} remises accordées à ${erosion.remiseFamilyCount} familles`
          : "Impact des concessions tarifaires sur les revenus"
      }
      headerActions={headerActions}
      contentClassName="p-4 space-y-3.5 flex-1 flex flex-col justify-center"
    >
      {erosion.remiseCount === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center py-8"
          data-testid="discount-erosion-empty"
        >
          Aucune remise commerciale enregistrée.
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-3xl font-bold font-mono text-foreground tabular-nums">
                {erosion.erosionPct}%
              </span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                du tarif catalogue brut concédé en réductions
              </span>
            </div>
            <div className="text-right font-mono">
              <span className="text-sm font-bold text-status-warning">
                −{formatDzd(erosion.remiseTotal, { compact: true })}
              </span>
              <span className="text-[10px] text-muted-foreground block">
                remises brutes
              </span>
            </div>
          </div>

          <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-status-warning transition-all"
              style={{ width: `${Math.min(100, erosion.erosionPct)}%` }}
            />
          </div>

          <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Volume catalogue brut
              </span>
              <span className="font-mono font-semibold">
                {formatDzdPlain(erosion.stickerTotal)} DA
              </span>
            </div>
            <div className="flex justify-between text-status-warning font-semibold">
              <span>Remises accordées</span>
              <span className="font-mono">
                −{formatDzdPlain(erosion.remiseTotal)} DA
              </span>
            </div>
            <div className="flex justify-between border-t border-border/40 pt-1.5 font-bold">
              <span>Net facturé (devis effectifs)</span>
              <span className="font-mono text-foreground">
                {formatDzdPlain(erosion.grossCharges)} DA
              </span>
            </div>
          </div>
        </>
      )}
    </ExecutiveCard>
  );
}
