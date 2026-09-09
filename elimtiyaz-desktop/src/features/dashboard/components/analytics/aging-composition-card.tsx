/**
 * AgingCompositionCard — the debt-aging composition (T-257, 38th session
 * — UI-307): a 100% stacked horizontal bar (share of outstanding per
 * aging bucket, AGING_COLORS) + the per-bucket statistical table
 * (amount / families / share) with an honest total row.
 *
 * Sibling of the Overview's recovery FUNNEL (family counts, T-243) — this
 * card answers the MONEY question (how the DZD is distributed across
 * buckets), from the same debtAging stream. Hovering a segment shows the
 * real amount + family count.
 */
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

export function AgingCompositionCard({ debtAging }: { debtAging: DebtByAgingBucket[] }) {
  const segments = useMemo(() => deriveAgingComposition(debtAging), [debtAging]);
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((s, x) => s + x.amount, 0);
  const totalFamilies = segments.reduce((s, x) => s + x.debtorCount, 0);

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Hourglass className="h-3.5 w-3.5 text-primary" />
          Structure de l'Impayé par Ancienneté
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {segments.length > 0 ? (
            <>
              {formatDzd(total, { compact: true })} d'encours · {totalFamilies} fam.
            </>
          ) : (
            "Répartition de l'encours par tranche de retard"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col justify-center gap-3">
        {segments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="aging-empty">
            Aucune créance ouverte sur la période.
          </p>
        ) : (
          <>
            {/* The 100% stacked composition bar. */}
            <div
              className="flex h-8 w-full rounded-md overflow-hidden border border-border/40"
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
                  title={`${seg.label} — ${formatDzdPlain(seg.amount)} DZD · ${seg.debtorCount} fam. · ${seg.share}%`}
                  onMouseEnter={() => setHover(seg.bucket)}
                  onMouseLeave={() => setHover(null)}
                  className="h-full flex items-center justify-center transition-all"
                  style={{
                    width: `${seg.share}%`,
                    backgroundColor: AGING_COLORS[seg.bucket],
                    opacity: hover === null || hover === seg.bucket ? 1 : 0.45,
                  }}
                >
                  {seg.share >= 12 && (
                    <span className="text-[10px] font-mono font-semibold text-white drop-shadow">
                      {seg.share}%
                    </span>
                  )}
                </div>
              ))}
            </div>
            {/* Per-bucket statistical table. */}
            <table className="w-full text-[11px]" data-testid="aging-table">
              <thead>
                <tr className="text-muted-foreground border-b border-border/40">
                  <th className="text-left font-medium py-1">Ancienneté</th>
                  <th className="text-right font-medium py-1">Encours</th>
                  <th className="text-right font-medium py-1">Familles</th>
                  <th className="text-right font-medium py-1">Part</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg) => (
                  <tr
                    key={seg.bucket}
                    className={`border-b border-border/20 ${hover === seg.bucket ? "bg-primary/5" : ""}`}
                    onMouseEnter={() => setHover(seg.bucket)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <td className="py-1.5 flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: AGING_COLORS[seg.bucket] }}
                      />
                      {seg.label}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {formatDzd(seg.amount, { compact: true })}
                    </td>
                    <td className="text-right font-mono tabular-nums">{seg.debtorCount}</td>
                    <td className="text-right font-mono tabular-nums">{seg.share}%</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5">Total</td>
                  <td className="text-right font-mono tabular-nums">
                    {formatDzd(total, { compact: true })}
                  </td>
                  <td className="text-right font-mono tabular-nums">{totalFamilies}</td>
                  <td className="text-right font-mono tabular-nums">100%</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
