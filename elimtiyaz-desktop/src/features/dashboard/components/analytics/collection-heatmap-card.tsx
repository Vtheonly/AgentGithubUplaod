/**
 * CollectionHeatmapCard — the Power BI matrix heatmap (T-256, 38th session
 * — UI-307): encaissé per school-weekday × calendar month, rendered as a
 * CSS grid with 5-level intensity cells (NOT a recharts chart — a matrix
 * is the honest geometry for weekday×month).
 *
 * Data: deriveCollectionHeatmap over the FILTERED paid slice. Cells carry
 * real (amount, count); the title attribute + hover tooltip shows both
 * plus the month key (year included — no ambiguity across year bounds).
 * Row/column totals are REAL sums of the same matrix. Friday/Saturday are
 * outside the Algerian school week (T-243 convention) and never appear.
 */
import { useMemo, useState } from "react";
import { Grid3x3 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { chartPalette } from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { Payment } from "../../../../domain/model/payment";
import { deriveCollectionHeatmap } from "./analytics-derivations";

/** 5-level intensity ramp over the brand blue (0 = empty, 4 = max). */
function cellStyle(level: number): { backgroundColor: string; color: string } {
  if (level === 0) {
    return { backgroundColor: "transparent", color: "hsl(var(--muted-foreground))" };
  }
  const alpha = [0, 0.22, 0.42, 0.66, 0.92][level];
  const textColor = level >= 3 ? "#ffffff" : "hsl(var(--muted-foreground))";
  return {
    backgroundColor: `rgba(52, 155, 212, ${alpha})`,
    color: textColor,
  };
}

export function CollectionHeatmapCard({
  slice,
  range,
}: {
  slice: readonly Payment[];
  range?: { from: string; to: string };
}) {
  const { monthLabels, monthKeys, rows, max, monthTotals } = useMemo(
    () => deriveCollectionHeatmap(slice, range),
    [slice, range],
  );
  const [hover, setHover] = useState<string | null>(null);
  const isEmpty = max === 0;

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Grid3x3 className="h-3.5 w-3.5 text-primary" />
          Calendrier des Encaissements
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Intensité par jour d'école (Dim–Jeu) × mois · pointez une cellule
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 overflow-x-auto">
        {isEmpty ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="heatmap-empty">
            Aucun encaissement ne correspond aux filtres sur la période.
          </p>
        ) : (
          <div className="min-w-max" data-testid="heatmap-grid">
            {/* Column headers — month labels. */}
            <div className="flex items-end gap-1 mb-1">
              <div className="w-9 shrink-0" />
              {monthLabels.map((label, i) => (
                <div
                  key={monthKeys[i]}
                  className="w-14 shrink-0 text-center text-[10px] font-mono text-muted-foreground truncate"
                  title={`${label} ${monthKeys[i]}`}
                >
                  {label}
                </div>
              ))}
              <div className="w-16 shrink-0 text-center text-[10px] font-mono text-muted-foreground/70">
                Σ jour
              </div>
            </div>
            {/* Matrix rows — one per school weekday. */}
            {rows.map((row) => (
              <div key={row.day} className="flex items-center gap-1 mb-1">
                <div className="w-9 shrink-0 text-[10px] font-mono text-muted-foreground">
                  {row.day}
                </div>
                {row.cells.map((cell, i) => {
                  const key = `${row.day}-${monthKeys[i]}`;
                  const isHover = hover === key;
                  return (
                    <div
                      key={key}
                      role="gridcell"
                      aria-label={`${row.day} ${monthLabels[i]} : ${formatDzdPlain(cell.amount)} DZD sur ${cell.count} opération(s)`}
                      title={`${row.day} ${monthLabels[i]} ${monthKeys[i]} — ${formatDzdPlain(cell.amount)} DZD · ${cell.count} op.`}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover(null)}
                      className={`w-14 h-7 shrink-0 rounded flex items-center justify-center text-[10px] font-mono tabular-nums border border-border/40 transition-transform ${
                        isHover ? "scale-105 border-primary/60 z-10" : ""
                      } ${cell.level === 0 ? "border-dashed" : ""}`}
                      style={cellStyle(cell.level)}
                      data-testid={`heatmap-cell-${row.day}-${monthKeys[i]}`}
                      data-amount={cell.amount}
                      data-count={cell.count}
                      data-level={cell.level}
                    >
                      {cell.amount > 0 ? compactK(cell.amount) : ""}
                    </div>
                  );
                })}
                <div
                  className="w-16 shrink-0 text-right text-[10px] font-mono text-muted-foreground tabular-nums"
                  title={`${row.day} — total ${formatDzdPlain(row.rowTotal)} DZD`}
                >
                  {row.rowTotal > 0 ? compactK(row.rowTotal) : "—"}
                </div>
              </div>
            ))}
            {/* Column totals row. */}
            <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-border/40">
              <div className="w-9 shrink-0 text-[10px] font-mono text-muted-foreground/70">
                Σ
              </div>
              {monthTotals.map((total, i) => (
                <div
                  key={monthKeys[i]}
                  className="w-14 shrink-0 text-center text-[10px] font-mono text-muted-foreground tabular-nums"
                  title={`${monthLabels[i]} ${monthKeys[i]} — total ${formatDzdPlain(total)} DZD`}
                >
                  {total > 0 ? compactK(total) : "—"}
                </div>
              ))}
              <div className="w-16 shrink-0" />
            </div>
            {/* Intensity legend. */}
            <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
              <span className="font-mono" style={{ color: chartPalette.primary }}>
                max {formatDzd(max, { compact: true })}
              </span>
              <span>·</span>
              {[1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className="h-2.5 w-4 rounded-sm border border-border/40"
                  style={cellStyle(level)}
                />
              ))}
              <span>faible → fort</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact k-notation for heatmap cells (12 400 → 12k). */
function compactK(v: number): string {
  if (v >= 1_000_000) return `${Math.round(v / 100_000) / 10}M`;
  if (v >= 10_000) return `${Math.round(v / 1_000)}k`;
  if (v >= 1_000) return `${Math.round(v / 100) / 10}k`;
  return String(v);
}
