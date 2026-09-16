// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/sparkline-kpi-card.tsx
// ============================================================================

/**
 * SparklineKpiCard — Executive KPI Tile with High-Definition Bezier Sparkline.
 *
 * Combines crisp typographic hierarchy, a subtle ambient top border,
 * a formatted trend delta pill, and an area-gradient sparkline.
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
  deltaPercent?: number;
  deltaPeriod?: string;
  trend?: number[];
  tone?: SparklineTone;
  onClick?: () => void;
  gradientKey?: string;
}

/**
 * Generates a smooth cubic-bezier SVG path string through an array of points.
 */
function generateSmoothSvgPath(
  points: Array<{ x: number; y: number }>,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function SparklineKpiCard({
  label,
  value,
  subValue,
  deltaPercent,
  deltaPeriod = "vs période préc.",
  trend,
  tone = "primary",
  onClick,
  gradientKey,
}: SparklineKpiCardProps) {
  const hasDelta =
    typeof deltaPercent === "number" && Number.isFinite(deltaPercent);
  const isPositive = hasDelta && (deltaPercent as number) > 0;
  const isZero = hasDelta && deltaPercent === 0;
  const color = STROKE_BY_TONE[tone];
  const hasSparkline = Array.isArray(trend) && trend.length >= 2;

  // Normalized geometry in a 92x36 viewBox
  const width = 92;
  const height = 36;
  let strokePath = "";
  let areaPath = "";

  if (hasSparkline && trend) {
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    const range = max - min || 1;

    const points = trend.map((val, i) => {
      const x = (i / (trend.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 10) - 5;
      return { x, y };
    });

    strokePath = generateSmoothSvgPath(points);
    areaPath = `${strokePath} L ${width} ${height} L 0 ${height} Z`;
  }

  const gradientId = `spark-grad-${(gradientKey ?? label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <Card
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/70 bg-surface-panel p-0 transition-all duration-200",
        onClick &&
          "cursor-pointer hover:border-primary/40 hover:bg-surface-elevated/50 hover:shadow-lg hover:shadow-black/20",
      )}
    >
      {/* Subtle top indicator bar with tone accent */}
      <div
        className="h-[2px] w-full"
        style={{
          background: `linear-gradient(90deg, ${color} 0%, transparent 80%)`,
        }}
      />

      <CardContent className="p-4 flex items-end justify-between gap-3">
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
              {label}
            </p>
          </div>

          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-bold font-mono tracking-tight text-foreground tabular-nums">
              {value}
            </span>
            {subValue && (
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {subValue}
              </span>
            )}
          </div>

          {hasDelta ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              <span
                className={cn(
                  "inline-flex items-center text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-md",
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
              <span className="text-[11px] text-muted-foreground truncate">
                {deltaPeriod}
              </span>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60 h-4">
              &nbsp;
            </div>
          )}
        </div>

        {hasSparkline && (
          <div className="w-[92px] h-[36px] shrink-0 mb-1" aria-hidden="true">
            <svg width={width} height={height} className="overflow-visible">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <path d={areaPath} fill={`url(#${gradientId})`} />
              <path
                d={strokePath}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
