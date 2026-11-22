/**
 * TransportYieldCard — E6.8 (UI-U7b / DUP-027): extracted verbatim from the
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

export function TransportYieldCard({
  transport,
  headerActions,
}: {
  transport: TransportYield;
  headerActions?: ReactNode;
}) {
  return (
    <ExecutiveCard
      testId="transport-yield-card"
      icon={<Bus className="h-4 w-4 text-brand-cyan" />}
      title="Rendement des Tournées Transport"
      infoTip="transport.card"
      description={`${transport.riders} élèves transportés · ${transport.routes.length} circuits`}
      headerActions={headerActions}
      contentClassName="p-4 space-y-3 flex-1 flex flex-col justify-between"
    >
      {transport.routes.length === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center py-8"
          data-testid="transport-yield-empty"
        >
          Aucune ligne de transport active.
        </p>
      ) : (
        <div className="space-y-2">
          {transport.routes.slice(0, 5).map((r) => (
            <div key={r.destination} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium truncate max-w-[180px]">
                  {TRANSPORT_DESTINATION_LABELS_FR[r.destination] ??
                    r.destination}
                </span>
                <span className="font-mono text-muted-foreground">
                  <strong className="text-foreground">{r.riders}</strong> él. ·{" "}
                  {r.collectedPct}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-cyan transition-all"
                  style={{ width: `${r.collectedPct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </ExecutiveCard>
  );
}
