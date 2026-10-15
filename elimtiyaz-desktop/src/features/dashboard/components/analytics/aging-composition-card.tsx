// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/aging-composition-card.tsx
// ============================================================================

import { useMemo, useState, type ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { InfoTip } from "./info-tip";
import { CardHeaderActions } from "./card-header-actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { AGING_COLORS } from "../../tabs/types";
import { formatDzd } from "../../../../core/format/currency";
import type { DebtByAgingBucket } from "../../../../domain/model/operations";
import { deriveAgingComposition } from "./analytics-derivations";

export function AgingCompositionCard({
  debtAging,
  headerActions,
  rowActions,
}: {
  debtAging: DebtByAgingBucket[];
  headerActions?: ReactNode;
  rowActions?: Partial<Record<DebtByAgingBucket["bucket"], ReactNode>>;
}) {
  const segments = useMemo(
    () => deriveAgingComposition(debtAging),
    [debtAging],
  );
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((s, x) => s + x.amount, 0);
  const totalFamilies = segments.reduce((s, x) => s + x.debtorCount, 0);

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm min-h-full flex flex-col justify-between"
      data-testid="aging-composition-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-primary" />
            Ancienneté des Créances
            <InfoTip tip="aging.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Répartition proportionnelle de la dette globale par tranche de retard
          </CardDescription>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {segments.length > 0 && (
            <span className="text-xs font-mono font-bold text-status-danger">
              {formatDzd(total, { compact: true })} · {totalFamilies} familles
            </span>
          )}
          <CardHeaderActions>{headerActions}</CardHeaderActions>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4 flex-1 flex flex-col justify-between">
        {segments.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="aging-empty"
          >
            Aucune créance ouverte sur la période active.
          </p>
        ) : (
          <>
            <div
              className="flex h-7 w-full rounded-xl overflow-hidden border border-border/60 shadow-inner"
              data-testid="aging-stacked-bar"
            >
              {segments.map((seg) => (
                <div
                  key={seg.bucket}
                  role="progressbar"
                  aria-label={`${seg.label} : ${seg.share}%`}
                  aria-valuenow={seg.share}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  onMouseEnter={() => setHover(seg.bucket)}
                  onMouseLeave={() => setHover(null)}
                  className="h-full flex items-center justify-center transition-all cursor-pointer"
                  style={{
                    width: `${seg.share}%`,
                    backgroundColor: AGING_COLORS[seg.bucket],
                    opacity: hover === null || hover === seg.bucket ? 1 : 0.45,
                  }}
                >
                  {seg.share >= 10 && (
                    <span className="text-[11px] font-mono font-bold text-white drop-shadow">
                      {seg.share}%
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="aging-table">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/60 text-left">
                    <th className="py-2 px-2 font-medium">Tranche de Retard</th>
                    <th className="py-2 px-2 text-right font-medium">Encours</th>
                    <th className="py-2 px-2 text-right font-medium">Familles</th>
                    <th className="py-2 px-2 text-right font-medium">Part</th>
                    <th className="py-2 px-2 text-right font-medium w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {segments.map((seg) => (
                    <tr
                      key={seg.bucket}
                      className={`hover:bg-accent/5 transition-colors ${
                        hover === seg.bucket ? "bg-primary/10" : ""
                      }`}
                      onMouseEnter={() => setHover(seg.bucket)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <td className="py-2 px-2 flex items-center gap-2 font-medium">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: AGING_COLORS[seg.bucket] }}
                        />
                        {seg.label}
                        <InfoTip tip={`aging.b${seg.bucket === "0_30" ? "0_30" : seg.bucket === "31_60" ? "31_60" : seg.bucket === "61_90" ? "61_90" : seg.bucket === "91_180" ? "91_180" : "180plus"}`} size={10} />
                      </td>
                      <td className="text-right font-mono font-bold text-foreground py-2 px-2">
                        {formatDzd(seg.amount, { compact: true })}
                      </td>
                      <td className="text-right font-mono py-2 px-2">
                        {seg.debtorCount}
                      </td>
                      <td className="text-right font-mono py-2 px-2 text-muted-foreground">
                        {seg.share}%
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {rowActions?.[seg.bucket] ?? null}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border/80 font-semibold">
                    <td className="py-2 px-2 font-bold">Total</td>
                    <td className="text-right font-mono font-bold py-2 px-2">
                      {formatDzd(
                        segments.reduce((s, seg) => s + seg.amount, 0),
                        { compact: true },
                      )}
                    </td>
                    <td className="text-right font-mono py-2 px-2">
                      {segments.reduce((s, seg) => s + seg.debtorCount, 0)}
                    </td>
                    <td className="text-right font-mono py-2 px-2">100%</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}