/**
 * ServiceYieldCard — E6.8 (UI-U7b / DUP-027): extracted verbatim from the
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

export function ServiceYieldCard({
  services,
  headerActions,
}: {
  services: ReturnType<typeof deriveServiceYield>;
  headerActions?: ReactNode;
}) {
  return (
    <ExecutiveCard
      testId="service-yield-card"
      icon={<Stethoscope className="h-4 w-4 text-brand-violet" />}
      title="Revenus Services Spécialisés"
      infoTip="services.card"
      description="Orthophonie, Psychologie et Activités Annexes"
      headerActions={headerActions}
      contentClassName="p-4 flex-1 flex flex-col justify-center"
    >
      {services.length === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center py-8"
          data-testid="service-yield-empty"
        >
          Aucun paiement de service enregistré.
        </p>
      ) : (
        <div className="space-y-2.5">
          {services.slice(0, 4).map((s) => (
            <div
              key={s.category}
              className="flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0"
            >
              <div>
                <span className="font-medium text-foreground block">
                  {s.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {s.studentCount} él. suivis · {s.paymentCount} règlements
                </span>
              </div>
              <span className="font-mono font-bold text-foreground">
                {formatDzd(s.revenue, { compact: true })}
              </span>
            </div>
          ))}
        </div>
      )}
    </ExecutiveCard>
  );
}
