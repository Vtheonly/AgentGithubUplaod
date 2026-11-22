/**
 * FamilyConcentrationCard — E6.8 (UI-U7b / DUP-027): extracted verbatim from the
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

export function FamilyConcentrationCard({
  concentration,
  headerActions,
}: {
  concentration: FamilyConcentration;
  headerActions?: ReactNode;
}) {
  const [referenceMode, setReferenceMode] =
    useState<ReferencePopulationMode>("whole-dataset");
  const shareOf = (f: FamilyExposure): number =>
    referenceMode === "top10"
      ? concentration.topTotal > 0
        ? Math.round((f.outstanding / concentration.topTotal) * 100)
        : 0
      : f.shareOfTotalDebt;

  return (
    <ExecutiveCard
      testId="family-concentration-card"
      icon={<Users className="h-4 w-4 text-primary" />}
      title="Concentration du Risque par Foyer"
      infoTip="concentration.card"
      description={
        <>
          Top {concentration.topFamilies.length} familles représentent{" "}
          <strong className="text-foreground">
            {concentration.topConcentrationPct}%
          </strong>{" "}
          de la dette globale
        </>
      }
      descriptionExtra={
        <div className="mt-1.5">
          <ReferencePopulationSelector
            mode={referenceMode}
            onChange={setReferenceMode}
            compact
            tipKey="concentration.referenceMode"
          />
        </div>
      }
      headerActions={headerActions}
      contentClassName="p-4 space-y-3 flex-1 flex flex-col justify-between"
    >
      {concentration.debtorFamilyCount === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center py-8"
          data-testid="family-concentration-empty"
        >
          Aucune créance familiale enregistrée.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground text-left">
                <th className="py-2 px-1 font-medium">Famille</th>
                <th className="py-2 px-1 text-center font-medium">Enfants</th>
                <th className="py-2 px-1 text-right font-medium">Encours</th>
                <th className="py-2 px-1 text-right font-medium">Part</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {concentration.topFamilies.slice(0, 5).map((f) => (
                <tr key={f.parentId} className="hover:bg-accent/5">
                  <td className="py-2 px-1 font-medium truncate max-w-[140px]">
                    {f.parentName}
                  </td>
                  <td className="py-2 px-1 text-center font-mono">
                    {f.childCount}
                  </td>
                  <td className="py-2 px-1 text-right font-mono font-bold text-status-danger">
                    {formatDzd(f.outstanding, { compact: true })}
                  </td>
                  <td className="py-2 px-1 text-right font-mono text-muted-foreground">
                    {shareOf(f)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ExecutiveCard>
  );
}
