/**
 * DebtTriageCard — E6.8 (UI-U7b / DUP-027): extracted verbatim from the
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

export function DebtTriageCard({
  triage,
  parents,
  headerActions,
}: {
  triage: DebtTriage;
  parents: readonly Parent[];
  headerActions?: ReactNode;
}) {
  const parentNameById = useMemo(
    () =>
      new Map(
        parents.map((p) => [
          p.id,
          // E2.5 / S-U1: the shared person resolver (id fallback preserved).
          personDisplayName(p, p.id),
        ]),
      ),
    [parents],
  );

  const colors: Record<string, string> = {
    not_due: "var(--status-info, #0ea5e9)",
    current: "var(--status-success, #10b981)",
    reminder: "var(--status-warning, #f59e0b)",
    chronic: "var(--status-danger, #ef4444)",
  };

  return (
    <ExecutiveCard
      testId="debt-triage-card"
      icon={<PhoneCall className="h-4 w-4 text-status-danger" />}
      title="Triage des Créances & File de Relance"
      infoTip="triage.card"
      description="Ventilation par degré d'urgence et dossiers à traiter en priorité"
      headerExtra={
        triage.totalOutstanding > 0 ? (
          <span className="text-xs font-mono font-bold text-status-danger">
            {formatDzd(triage.totalOutstanding, { compact: true })} total
          </span>
        ) : null
      }
      headerActions={headerActions}
      contentClassName="p-4 space-y-3.5 flex-1"
    >
      {triage.totalOutstanding === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center py-8"
          data-testid="debt-triage-empty"
        >
          Toutes les créances sont à jour — aucun dossier en retard.
        </p>
      ) : (
        <>
          <div className="space-y-2" data-testid="debt-triage-buckets">
            {triage.buckets.map((b) => (
              <div key={b.bucket} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: colors[b.bucket] }}
                    />
                    {b.label}
                    <InfoTip tip={`triage.${b.bucket}`} size={10} />
                  </span>
                  <span className="font-mono text-muted-foreground">
                    <strong className="text-foreground">
                      {formatDzd(b.amount, { compact: true })}
                    </strong>{" "}
                    ({b.familyCount} fam.)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${b.share}%`,
                      backgroundColor: colors[b.bucket],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {triage.callList.length > 0 && (
            <div
              className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-3 space-y-2"
              data-testid="debt-triage-call-list"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-status-danger uppercase tracking-wider flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  File d'Appel Urgent (&gt; 45 jours)
                  <InfoTip tip="triage.callList" size={10} />
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {triage.callList.length} familles
                </span>
              </div>

              <div className="space-y-1.5">
                {triage.callList.slice(0, 4).map((item) => (
                  <div
                    key={item.parentId}
                    className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0"
                  >
                    <span className="font-medium truncate max-w-[170px]">
                      {parentNameById.get(item.parentId) ?? "Famille"}
                    </span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-[10px] text-muted-foreground">
                        {item.worstDaysOverdue}j retard
                      </span>
                      <span className="font-bold text-status-danger">
                        {formatDzdPlain(item.outstanding)} DA
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </ExecutiveCard>
  );
}
