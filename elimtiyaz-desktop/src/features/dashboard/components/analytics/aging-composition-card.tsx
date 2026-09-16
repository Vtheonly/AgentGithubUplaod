// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/aging-composition-card.tsx
// ============================================================================

import { useMemo, useState } from "react";
import { Hourglass } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { AGING_COLORS } from "../../tabs/types";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { DebtByAgingBucket } from "../../../../domain/model/operations";
import { deriveAgingComposition } from "./analytics-derivations";

export function AgingCompositionCard({
  debtAging,
}: {
  debtAging: DebtByAgingBucket[];
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
      className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between"
      data-testid="aging-composition-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-primary" />
            Structure d'Ancienneté de l'Encours
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Répartition proportionnelle de la dette globale
          </CardDescription>
        </div>

        {segments.length > 0 && (
          <span className="text-xs font-mono font-bold text-status-danger">
            {formatDzd(total, { compact: true })} · {totalFamilies} familles
          </span>
        )}
      </CardHeader>

      <CardContent className="p-4 space-y-4 flex-1 flex flex-col justify-center">
        {segments.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="aging-empty"
          >
            Aucune créance ouverte sur la période active.
          </p>
        ) : (
          <>
            {/* 100% Stacked Bar */}
            <div
              className="flex h-7 w-full rounded-xl overflow-hidden border border-border/60 shadow-inner"
              data-testid="aging-stacked-bar"
            >
              {segments.map((seg) => (
                <div
                  key={seg.bucket}
                  role="progressbar"
                  aria-label={`${seg.label} : ${seg.share}%`}
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

            {/* Table Breakdown */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="aging-table">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/60 text-left">
                    <th className="py-2 px-2 font-medium">Tranche de Retard</th>
                    <th className="py-2 px-2 text-right font-medium">
                      Encours
                    </th>
                    <th className="py-2 px-2 text-right font-medium">
                      Familles
                    </th>
                    <th className="py-2 px-2 text-right font-medium">Part</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
