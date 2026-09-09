/**
 * SparklineKpiCard — Screen-5-style executive KPI tile (T-243, 2026-09-09).
 *
 * Source: the owner's AI-review blueprint "The Sparkline KPI Card (Screen 5
 * Style)" — metric label (10px uppercase) → big mono value → inline trend
 * badge + 24-84px area-gradient sparkline.
 *
 * Adaptation (documented in UI-306, §15.16 — never synthesize data):
 *   - `trend` and `deltaPercent` are OPTIONAL. The review's sample code
 *     hardcoded `deltaPercent: 12.4` + `trend: [120, 140, …]` on every
 *     card; the dashboard's repository contract only carries a REAL time
 *     series for the revenue metrics. Cards without a real series render
 *     WITHOUT the sparkline and WITHOUT a delta badge — no fake numbers.
 *     (Rule: a financial/operational trend shown to the admin must come
 *     from the repository stream, not from a component default.)
 *   - Clicking drills into the SeeDetailsModal sub-tab, same contract as
 *     the previous KpiButton wrapper (dashboard-page.tsx drillByKpi map).
 *
 * UI-301 safety: the value is `break-words` (Intl fr-FR grouping uses
 * U+202F/U+00A0 unbreakable separators — the t-200/t-205 guard families).
 */
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Card, CardContent } from "../../../shared/ui/card";
import { cn } from "../../../shared/ui/cn";

export type SparklineTone = "primary" | "success" | "danger" | "warning";

const STROKE_BY_TONE: Record<SparklineTone, string> = {
  primary: "#349bd4",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
};

export interface SparklineKpiCardProps {
  label: string;
  value: string;
  subValue?: string;
  /** REAL month-over-month delta from the loaded series — omit when no series. */
  deltaPercent?: number;
  deltaPeriod?: string;
  /** REAL series from the repository (e.g. monthly revenue) — omit to hide the sparkline. */
  trend?: number[];
  tone?: SparklineTone;
  onClick?: () => void;
  /** Stable key for SVG gradient ids when several cards render side by side. */
  gradientKey?: string;
}

export function SparklineKpiCard({
  label,
  value,
  subValue,
  deltaPercent,
  deltaPeriod = "vs mois dernier",
  trend,
  tone = "primary",
  onClick,
  gradientKey,
}: SparklineKpiCardProps) {
  const hasDelta = typeof deltaPercent === "number" && Number.isFinite(deltaPercent);
  const isPositive = hasDelta && (deltaPercent as number) > 0;
  const isZero = hasDelta && deltaPercent === 0;
  const color = STROKE_BY_TONE[tone];
  const hasSparkline = Array.isArray(trend) && trend.length >= 2;

  // SVG sparkline geometry — normalized into an 84×32 viewBox.
  const width = 84;
  const height = 32;
  let points = "";
  let areaPoints = "";
  if (hasSparkline && trend) {
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    const range = max - min || 1;
    points = trend
      .map((val, i) => {
        const x = (i / (trend.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    areaPoints = `0,${height} ${points} ${width},${height}`;
  }
  const gradientId = `sparkline-grad-${(gradientKey ?? label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <Card
      onClick={onClick}
      className={cn(
        "relative overflow-hidden border border-border bg-surface-panel transition-all duration-200",
        onClick && "cursor-pointer hover:border-primary/50 hover:bg-surface-elevated/40",
      )}
    >
      <CardContent className="p-3.5 flex items-end justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {label}
          </p>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-xl font-bold font-mono tracking-tight text-foreground tnum break-words">
              {value}
            </span>
            {subValue && (
              <span className="text-[11px] font-mono text-muted-foreground break-words">
                {subValue}
              </span>
            )}
          </div>
          {hasDelta ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              <span
                className={cn(
                  "inline-flex items-center text-[10px] font-mono font-semibold px-1 py-0.5 rounded",
                  isZero
                    ? "bg-muted text-muted-foreground"
                    : isPositive
                      ? "bg-status-success/15 text-status-success"
                      : "bg-status-danger/15 text-status-danger",
                )}
              >
                {isZero ? (
                  <Minus className="h-2.5 w-2.5 mr-0.5" />
                ) : isPositive ? (
                  <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" />
                ) : (
                  <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />
                )}
                {Math.abs(deltaPercent as number)}%
              </span>
              <span className="text-[10px] text-muted-foreground truncate">{deltaPeriod}</span>
            </div>
          ) : (
            <div className="pt-0.5 text-[10px] text-muted-foreground truncate">&nbsp;</div>
          )}
        </div>

        {hasSparkline && trend && (
          <div className="w-[84px] h-[32px] shrink-0" aria-hidden="true">
            <svg width={width} height={height} className="overflow-visible">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <polygon points={areaPoints} fill={`url(#${gradientId})`} />
              <polyline
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
