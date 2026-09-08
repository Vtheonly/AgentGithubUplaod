/**
 * WeeklyOperatingRhythm — Screen-1/3-style day-of-week stacked bars
 * (T-243, 2026-09-09).
 *
 * Source: the owner's AI-review blueprint "Algerian School-Week Rhythm
 * Chart (Screen 1 & 3 Adapted)" — honor the Algerian educational operating
 * rhythm (Dimanche à Jeudi, NOT Mon–Sun), volumes stacked by payment
 * method.
 *
 * Adaptation (documented in UI-306, §15.16):
 *   - The review's WEEK_DATA hardcoded per-day amounts. The REAL stream
 *     exists: the canonical `Payment[]` observable (collectedAt + method +
 *     status), which the page subscribes to once (T-088 single-fetch
 *     pipeline) and passes down. This component derives the weekday ×
 *     method matrix from those REAL rows — nothing synthesized.
 *   - Payments are counted when recorded at the counter (status
 *     "refunded" excluded — no net movement).
 *   - Empty state: an honest message when no payment falls inside the
 *     selected period.
 */
import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CalendarCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../shared/ui/card";
import { formatDzdPlain } from "../../../core/format/currency";
import { DASHBOARD_THEME, chartPalette } from "../../../shared/ui/dashboard-theme";
import { PAYMENT_METHOD_LABELS_FR, type Payment, type PaymentMethod } from "../../../domain/model/payment";

/** Algerian school week — Sunday → Thursday (Dimanche à Jeudi). */
const SCHOOL_WEEK: { key: string; jsDay: number }[] = [
  { key: "Dim", jsDay: 0 },
  { key: "Lun", jsDay: 1 },
  { key: "Mar", jsDay: 2 },
  { key: "Mer", jsDay: 3 },
  { key: "Jeu", jsDay: 4 },
];

const METHODS: PaymentMethod[] = ["cash", "check", "transfer"];

export interface WeeklyRhythmDatum {
  day: string;
  cash: number;
  check: number;
  transfer: number;
}

/**
 * Derive the weekday × method collection matrix from REAL payments.
 * Pure function — exported for unit tests (T-243 test suite).
 */
export function deriveWeeklyRhythm(
  payments: readonly Payment[],
  range?: { from: string; to: string },
): WeeklyRhythmDatum[] {
  const fromTs = range ? Date.parse(`${range.from}T00:00:00Z`) : null;
  const toTs = range ? Date.parse(`${range.to}T23:59:59Z`) : null;
  const cells = SCHOOL_WEEK.map(() => ({ cash: 0, check: 0, transfer: 0 }));
  for (const p of payments) {
    if (p.status === "refunded") continue;
    const ts = Date.parse(p.collectedAt);
    if (Number.isNaN(ts)) continue;
    if (fromTs !== null && ts < fromTs) continue;
    if (toTs !== null && ts > toTs) continue;
    const jsDay = new Date(ts).getUTCDay();
    const idx = SCHOOL_WEEK.findIndex((d) => d.jsDay === jsDay);
    if (idx === -1) continue; // Fri/Sat — outside the Algerian school week
    cells[idx][p.method] += p.amount;
  }
  return SCHOOL_WEEK.map((d, i) => ({ day: d.key, ...cells[i] }));
}

export function WeeklyOperatingRhythm({
  payments,
  range,
}: {
  payments: readonly Payment[];
  range?: { from: string; to: string };
}) {
  const data = useMemo(() => deriveWeeklyRhythm(payments, range), [payments, range]);
  const isEmpty = data.every((d) => d.cash === 0 && d.check === 0 && d.transfer === 0);

  return (
    <Card className="h-full border-border bg-surface-panel flex flex-col justify-between">
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <CalendarCheck className="h-3.5 w-3.5 text-primary" />
            Rythme d'Encaissement Hebdomadaire
          </CardTitle>
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground shrink-0">
            {METHODS.map((m) => (
              <span key={m} className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      m === "cash"
                        ? chartPalette.primary
                        : m === "check"
                          ? chartPalette.gold
                          : chartPalette.cyan,
                  }}
                />
                {PAYMENT_METHOD_LABELS_FR[m]}
              </span>
            ))}
          </div>
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          Volume journalier au guichet (Dimanche à Jeudi)
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-3 flex-1">
        {isEmpty ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            Aucun encaissement sur la période sélectionnée.
          </p>
        ) : (
          <div className="h-[160px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 5, right: 0, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="day"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(val: number, name: string) => [
                    `${formatDzdPlain(val)} DZD`,
                    PAYMENT_METHOD_LABELS_FR[name as PaymentMethod] ?? name,
                  ]}
                />
                <Bar dataKey="cash" stackId="a" fill={chartPalette.primary} radius={[0, 0, 0, 0]} />
                <Bar dataKey="check" stackId="a" fill={chartPalette.gold} radius={[0, 0, 0, 0]} />
                <Bar dataKey="transfer" stackId="a" fill={chartPalette.cyan} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
