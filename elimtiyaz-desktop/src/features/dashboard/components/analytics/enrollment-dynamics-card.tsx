/**
 * EnrollmentDynamicsCard — E6.8 (UI-U7b / DUP-027): extracted verbatim from the
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

export function EnrollmentDynamicsCard({
  dynamics,
  headerActions,
}: {
  dynamics: EnrollmentDynamics;
  headerActions?: ReactNode;
}) {
  return (
    <ExecutiveCard
      testId="enrollment-dynamics-card"
      icon={<Scale className="h-4 w-4 text-primary" />}
      title="Dynamique des Effectifs & Fratries"
      infoTip="dynamics.card"
      description={
        <>
          Indice fratrie :{" "}
          <strong className="text-foreground">
            {dynamics.siblingIndex?.toFixed(2) ?? "—"}
          </strong>{" "}
          élèves par famille
        </>
      }
      headerActions={headerActions}
      contentClassName="p-4 space-y-3.5 flex-1 flex flex-col justify-between"
    >
      {dynamics.totalFamilies === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center py-8"
          data-testid="enrollment-dynamics-empty"
        >
          Aucun élève actif répertorié.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
              <span className="text-[10px] uppercase text-muted-foreground block">
                Total Élèves
              </span>
              <span className="text-lg font-bold font-mono">
                {dynamics.totalStudents}
              </span>
            </div>
            <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
              <span className="text-[10px] uppercase text-muted-foreground block">
                Foyers Inscrits
              </span>
              <span className="text-lg font-bold font-mono">
                {dynamics.totalFamilies}
              </span>
            </div>
          </div>

          <div className="space-y-1.5" data-testid="family-size-distribution">
            <span className="text-[11px] font-semibold text-muted-foreground block">
              Répartition taille des familles :
            </span>
            <div className="flex gap-1.5">
              {dynamics.familySizes.map((sz) => (
                <div
                  key={sz.label}
                  className="flex-1 rounded-md bg-surface-elevated/50 p-1.5 text-center border border-border/40"
                >
                  <span className="text-[10px] font-mono text-muted-foreground block">
                    {sz.label}
                  </span>
                  <span className="text-xs font-bold font-mono text-foreground">
                    {sz.familyCount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </ExecutiveCard>
  );
}
