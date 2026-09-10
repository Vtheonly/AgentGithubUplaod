// ============================================================================
// FILE: elimtiyaz-desktop/src/features/ai/chart-svg.tsx
// ============================================================================
/**
 * Zero-dependency SVG chart engine for copilot artifacts (T-272, 42nd
 * session — AI-311a).
 *
 * Renders the six chart types the artifact contract allows:
 *   bar · grouped_bar · stacked_bar · line · area · pie · donut
 *
 * Design constraints (why custom SVG, ADR-016 §6):
 *   - The repo's philosophy is zero-dependency primitives (the copilot
 *     already renders markdown through its own markdown-view.tsx, not
 *     react-markdown); recharts would add ~100kB for charts that live
 *     in a 576px drawer.
 *   - The dark theme palette is pinned here to the app's CSS variables'
 *     literal hex values (status-success/warning/danger/info + primary
 *     blue) so charts match KPI cards without runtime CSS resolution
 *     (SVG attributes can't consume Tailwind classes).
 *
 * Layout hygiene: every chart is computed on a fixed viewBox (560×320)
 * and scales responsively (w-full h-auto) — no fixed pixel layout, no
 * text overflow at French label lengths (labels truncate with
 * ellipses past their measured budget).
 */
import React from "react";
import type { ChartArtifact, ChartSeries } from "../../core/ai/artifacts";

/** The drawer palette — matches --primary + --status-* tokens. */
const PALETTE = [
  "#2f8fd6", // primary blue (hsl 201 68% 52%)
  "#10b981", // status-success
  "#f59e0b", // status-warning
  "#0ea5e9", // status-info
  "#a78bfa", // violet (harmonized accent)
  "#ef4444", // status-danger
];

const W = 560;
const H = 320;
const PAD = { top: 14, right: 14, bottom: 42, left: 56 };

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

/** Compact axis formatting: 1 250 000 → "1,3M", 12 500 → "12,5k". */
function fmtAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1).replace(".", ",")}G`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(".", ",")}k`;
  return `${Math.round(v)}`;
}

/** Value label formatting per unit. */
function fmtValue(v: number, unit: ChartArtifact["unit"]): string {
  switch (unit) {
    case "DZD":
      return `${v.toLocaleString("fr-FR")} DA`;
    case "percent":
    case "rate":
      return `${v.toLocaleString("fr-FR")}${unit === "percent" ? "%" : ""}`;
    default:
      return v.toLocaleString("fr-FR");
  }
}

/** Truncate a label to its pixel budget (approx 6.2px/char at 10px). */
function fitLabel(label: string, maxPx: number): string {
  const maxChars = Math.floor(maxPx / 6.2);
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** "Nice" axis maximum (1/2/5 × 10^k above the data max). */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 5, 10]) {
    if (max <= m * base) return m * base;
  }
  return 10 * base;
}

/* ------------------------------------------------------------------ */
/*  The engine                                                         */
/* ------------------------------------------------------------------ */

export function ChartSvg({ chart }: { chart: ChartArtifact }) {
  switch (chart.chartType) {
    case "bar":
      return <BarChart chart={chart} />;
    case "grouped_bar":
      return <GroupedBarChart chart={chart} />;
    case "stacked_bar":
      return <StackedBarChart chart={chart} />;
    case "line":
    case "area":
      return <LineChart chart={chart} area={chart.chartType === "area"} />;
    case "pie":
    case "donut":
      return <PieChart chart={chart} donut={chart.chartType === "donut"} />;
    default:
      return null; // unreachable: validated artifact
  }
}

/* ---------------------------- bar family ---------------------------- */

function AxisFrame({ maxY, unit, yTicks = 4 }: { maxY: number; unit?: ChartArtifact["unit"]; yTicks?: number }) {
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (maxY / yTicks) * i);
  return (
    <g>
      {ticks.map((t, i) => {
        const y = PAD.top + (1 - t / maxY) * (H - PAD.top - PAD.bottom);
        return (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity={i === 0 ? 0.35 : 0.12}
              strokeDasharray={i === 0 ? undefined : "3 3"}
              className="text-muted-foreground"
            />
            <text
              x={PAD.left - 6}
              y={y + 3}
              textAnchor="end"
              fontSize={9}
              className="fill-muted-foreground"
            >
              {fmtAxis(t)}
            </text>
          </g>
        );
      })}
      {unit === "DZD" && (
        <text x={PAD.left - 6} y={PAD.top - 4} textAnchor="end" fontSize={8} className="fill-muted-foreground">
          DZD
        </text>
      )}
    </g>
  );
}

function XLabels({ categories, slots }: { categories: readonly string[]; slots: readonly number[] }) {
  const bandW = (W - PAD.left - PAD.right) / categories.length;
  return (
    <g>
      {categories.map((c, i) => (
        <text
          key={i}
          x={slots[i]}
          y={H - PAD.bottom + 14}
          textAnchor={categories.length > 8 ? (i % 2 === 0 ? "middle" : "end") : "middle"}
          fontSize={9}
          className="fill-muted-foreground"
        >
          {fitLabel(c, bandW + 8)}
        </text>
      ))}
    </g>
  );
}

function BarChart({ chart }: { chart: ChartArtifact }) {
  const series = chart.series[0];
  const data = series.data;
  const max = niceMax(Math.max(...data, 0));
  const bandW = (W - PAD.left - PAD.right) / data.length;
  const barW = Math.min(46, bandW * 0.62);
  const slots = data.map((_, i) => PAD.left + bandW * i + bandW / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={chart.title}>
      <AxisFrame maxY={max} unit={chart.unit} />
      {data.map((v, i) => {
        const h = (v / max) * (H - PAD.top - PAD.bottom);
        return (
          <g key={i}>
            <rect
              x={slots[i] - barW / 2}
              y={H - PAD.bottom - h}
              width={barW}
              height={Math.max(0, h)}
              rx={3}
              fill={PALETTE[0]}
              fillOpacity={0.88}
            />
            {data.length <= 12 && v > 0 && (
              <text
                x={slots[i]}
                y={H - PAD.bottom - h - 5}
                textAnchor="middle"
                fontSize={8.5}
                className="fill-foreground"
              >
                {fmtAxis(v)}
              </text>
            )}
          </g>
        );
      })}
      <XLabels categories={chart.categories} slots={slots} />
      <Legend series={[series]} />
    </svg>
  );
}

function GroupedBarChart({ chart }: { chart: ChartArtifact }) {
  const series = chart.series;
  const max = niceMax(Math.max(...series.flatMap((s) => s.data), 0));
  const bandW = (W - PAD.left - PAD.right) / chart.categories.length;
  const groupW = Math.min(46, bandW * 0.8);
  const barW = Math.max(3, groupW / series.length);
  const slots = chart.categories.map((_, i) => PAD.left + bandW * i + bandW / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={chart.title}>
      <AxisFrame maxY={max} unit={chart.unit} />
      {chart.categories.map((_, ci) =>
        series.map((s, si) => {
          const v = s.data[ci];
          const h = (v / max) * (H - PAD.top - PAD.bottom);
          const x = slots[ci] - groupW / 2 + si * barW;
          return (
            <rect
              key={`${ci}-${si}`}
              x={x}
              y={H - PAD.bottom - h}
              width={barW - 1}
              height={Math.max(0, h)}
              rx={2}
              fill={PALETTE[si % PALETTE.length]}
              fillOpacity={0.88}
            />
          );
        }),
      )}
      <XLabels categories={chart.categories} slots={slots} />
      <Legend series={series} />
    </svg>
  );
}

function StackedBarChart({ chart }: { chart: ChartArtifact }) {
  const series = chart.series;
  const totals = chart.categories.map((_, ci) => series.reduce((s, ser) => s + ser.data[ci], 0));
  const max = niceMax(Math.max(...totals, 0));
  const bandW = (W - PAD.left - PAD.right) / chart.categories.length;
  const barW = Math.min(46, bandW * 0.62);
  const slots = chart.categories.map((_, i) => PAD.left + bandW * i + bandW / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={chart.title}>
      <AxisFrame maxY={max} unit={chart.unit} />
      {chart.categories.map((_, ci) => {
        let acc = 0;
        return (
          <g key={ci}>
            {series.map((s, si) => {
              const h = (s.data[ci] / max) * (H - PAD.top - PAD.bottom);
              const y = H - PAD.bottom - acc - h;
              acc += h;
              return (
                <rect
                  key={si}
                  x={slots[ci] - barW / 2}
                  y={y}
                  width={barW}
                  height={Math.max(0, h)}
                  fill={PALETTE[si % PALETTE.length]}
                  fillOpacity={0.88}
                  rx={si === series.length - 1 ? 3 : 0}
                />
              );
            })}
          </g>
        );
      })}
      <XLabels categories={chart.categories} slots={slots} />
      <Legend series={series} />
    </svg>
  );
}

function LineChart({ chart, area }: { chart: ChartArtifact; area: boolean }) {
  const series = chart.series;
  const all = series.flatMap((s) => s.data);
  const max = niceMax(Math.max(...all, 0));
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const bandW = (W - PAD.left - PAD.right) / Math.max(1, chart.categories.length - 1);
  const x = (i: number) => PAD.left + bandW * i;
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={chart.title}>
      <AxisFrame maxY={max} unit={chart.unit} />
      {series.map((s, si) => {
        const points = s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        const color = PALETTE[si % PALETTE.length];
        return (
          <g key={si}>
            {area && (
              <polygon
                points={`${PAD.left},${y(min)} ${points} ${x(s.data.length - 1)},${y(min)}`}
                fill={color}
                fillOpacity={0.14}
              />
            )}
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.data.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={color} />
            ))}
          </g>
        );
      })}
      <XLabels
        categories={chart.categories}
        slots={chart.categories.map((_, i) => x(i))}
      />
      <Legend series={series} />
    </svg>
  );
}

function PieChart({ chart, donut }: { chart: ChartArtifact; donut: boolean }) {
  const data = chart.series[0].data;
  const total = data.reduce((s, v) => s + v, 0);
  const cx = W / 2;
  const cy = (H - 20) / 2;
  const r = Math.min(H - 60, W / 2 - 130) / 1.15;
  const innerR = r * 0.58;

  // Per-slice geometry, computed once: [a0, a1] around the circle,
  // starting at 12 o'clock, clockwise.
  let angle = -Math.PI / 2;
  const slices = data.map((value, i) => {
    const frac = total > 0 ? value / total : 0;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    return { i, value, frac, a0, a1 };
  });

  const pt = (radius: number, a: number): [number, number] => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  const arcLarge = (s: (typeof slices)[number]) => (s.a1 - s.a0 > Math.PI ? 1 : 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={chart.title}>
      {slices.map((s) => {
        const color = PALETTE[s.i % PALETTE.length];
        if (s.frac <= 0) return null;
        const [ox0, oy0] = pt(r, s.a0);
        const [ox1, oy1] = pt(r, s.a1);
        const d = donut
          ? `M ${ox0} ${oy0} A ${r} ${r} 0 ${arcLarge(s)} 1 ${ox1} ${oy1} L ${pt(innerR, s.a1)[0]} ${pt(innerR, s.a1)[1]} A ${innerR} ${innerR} 0 ${arcLarge(s)} 0 ${pt(innerR, s.a0)[0]} ${pt(innerR, s.a0)[1]} Z`
          : `M ${cx} ${cy} L ${ox0} ${oy0} A ${r} ${r} 0 ${arcLarge(s)} 1 ${ox1} ${oy1} Z`;
        return <path key={s.i} d={d} fill={color} fillOpacity={0.9} stroke="hsl(222 47% 11%)" strokeWidth={1} />;
      })}
      {donut && total > 0 && (
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={13} fontWeight={600} className="fill-foreground">
          {fmtValue(total, chart.unit)}
        </text>
      )}
      {/* Legend on the right: label + share + value per slice */}
      {chart.categories.map((c, i) => (
        <g key={i} transform={`translate(${W - 122}, ${cy - (chart.categories.length * 22) / 2 + i * 22})`}>
          <rect width={10} height={10} rx={2} fill={PALETTE[i % PALETTE.length]} />
          <text x={16} y={9} fontSize={10} className="fill-foreground">
            {fitLabel(c, 100)}
          </text>
          <text x={16} y={20} fontSize={9} className="fill-muted-foreground">
            {total > 0 ? ((data[i] / total) * 100).toFixed(0) : 0}% · {fmtValue(data[i], chart.unit)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------- legend ---------------------------- */

function Legend({ series }: { series: readonly ChartSeries[] }) {
  return (
    <g>
      {series.map((s, i) => (
        <g key={i} transform={`translate(${PAD.left + i * 130}, ${H - 12})`}>
          <rect width={9} height={9} rx={2} fill={PALETTE[i % PALETTE.length]} />
          <text x={14} y={8} fontSize={9.5} className="fill-muted-foreground">
            {fitLabel(s.name, 110)}
          </text>
        </g>
      ))}
    </g>
  );
}
