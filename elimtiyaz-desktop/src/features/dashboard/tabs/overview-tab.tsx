/**
 * Overview tab — KPIs + charts + calendar (no alerts, no departments).
 *
 * Extracted from `dashboard-page.tsx` (Task 2-a). Behavior is preserved
 * exactly — only file location and imports changed.
 */
import { useTranslation } from "react-i18next";
import {
  Users,
  Wallet,
  AlertTriangle,
  GraduationCap,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../../domain/model/operations";
import { formatDzd, formatDzdPlain } from "../../../core/format/currency";
import { AGING_BUCKET_LABELS_FR } from "../../../domain/model/payment";

/** Resolve a design-token CSS variable to its runtime hex value (plan §03). */
function token(name: string, fallback: string): string {
  try {
    if (typeof document === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}
import { KpiCard } from "../../../shared/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { DashboardCalendar } from "../dashboard-calendar";
import {
  type SeeDetailsTab,
  type Demographics,
  AGING_COLORS,
} from "./types";

export function OverviewTab({
  kpis,
  revenue,
  debtAging,
  demographics,
  onDrillDown,
}: {
  kpis: DashboardKpi | null;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: Demographics;
  onDrillDown: (tab: SeeDetailsTab) => void;
}) {
  const { t } = useTranslation();
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalDebt = debtAging.reduce((s, d) => s + d.amount, 0);
  const collectionRate = totalRevenue + totalDebt > 0
    ? Math.round((totalRevenue / (totalRevenue + totalDebt)) * 100)
    : 0;

  // Color tokens resolved at runtime — never hard-coded hex (plan §03).
  const gradeColor = token("--brand-blue", "#349bd4");
  const genderColors = [token("--brand-blue", "#349bd4"), token("--brand-gold", "#c8a98c"), token("--brand-slate", "#3b464c")];

  return (
    <div className="space-y-4">
      {/* KPI grid — clickable to drill down */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onDrillDown("demographics")}
          className="text-start"
          title="Cliquer pour voir la démographie"
        >
          <KpiCard
            label={t("dashboard.kpi.totalStudents")}
            value={kpis?.totalStudents ?? "—"}
            icon={<GraduationCap className="h-5 w-5" />}
            tone="info"
          />
        </button>
        <button
          type="button"
          onClick={() => onDrillDown("demographics")}
          className="text-start"
          title="Cliquer pour voir la démographie"
        >
          <KpiCard
            label={t("dashboard.kpi.totalParents")}
            value={kpis?.totalParents ?? "—"}
            icon={<Users className="h-5 w-5" />}
            tone="default"
          />
        </button>
        <button
          type="button"
          onClick={() => onDrillDown("revenue")}
          className="text-start"
          title="Cliquer pour voir le détail des revenus"
        >
          <KpiCard
            label={t("dashboard.kpi.monthlyRevenue")}
            value={kpis ? formatDzd(kpis.monthlyRevenue, { compact: true }) : "—"}
            icon={<Wallet className="h-5 w-5" />}
            tone="success"
            hint="Revenu encaissé"
          />
        </button>
        <button
          type="button"
          onClick={() => onDrillDown("debt")}
          className="text-start"
          title="Cliquer pour voir le détail des créances"
        >
          <KpiCard
            label={t("dashboard.kpi.outstandingDebt")}
            value={kpis ? formatDzd(kpis.outstandingDebt, { compact: true }) : "—"}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="danger"
            hint={`${kpis?.overdueAlerts ?? 0} alertes`}
          />
        </button>
      </div>

      {/* Charts — revenue + debt aging (departments removed per spec §2.3) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("revenue")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t("dashboard.charts.revenue")}
            </CardTitle>
            <CardDescription>
              Revenu encaissé (paiements PAID uniquement) — {revenue.length} mois
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  />
                  <RTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "hsl(var(--popover-foreground))",
                    }}
                    formatter={(value: number) => [formatDzd(value), "Revenu"]}
                  />
                  <Bar dataKey="amount" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("debt")}>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.debtAging")}</CardTitle>
            <CardDescription>Répartition par tranche d'âge</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {debtAging.map((b) => {
                const max = Math.max(...debtAging.map((x) => x.amount), 1);
                const w = (b.amount / max) * 100;
                return (
                  <div key={b.bucket} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{AGING_BUCKET_LABELS_FR[b.bucket]}</span>
                      <span className="font-mono text-foreground">{formatDzdPlain(b.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${w}%`, backgroundColor: AGING_COLORS[b.bucket] }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {b.debtorCount} débiteur{b.debtorCount > 1 ? "s" : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Demographics (formerly in Analytics tab — merged per spec §2.2) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("demographics")}>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.gradeDistribution")}</CardTitle>
            <CardDescription>Effectifs par niveau (1AP → 3ème Année)</CardDescription>
          </CardHeader>
          <CardContent>
            {/* VAULT §15.03 — grade distribution is a BAR chart per grade
                (a pie cannot show a distribution over 14 grade levels). */}
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={demographics.grade}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} interval={0} angle={-35} textAnchor="end" height={44} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v} élèves`, "Effectif"]}
                  />
                  <Bar dataKey="count" fill={gradeColor} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("demographics")}>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.genderDistribution")}</CardTitle>
            <CardDescription>Répartition par genre</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={demographics.gender} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {demographics.gender.map((_, i) => (
                      <Cell key={i} fill={genderColors[i % genderColors.length]} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-3 mt-2">
              {demographics.gender.map((s, i) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: genderColors[i % genderColors.length] }} />
                  <span className="text-xs text-muted-foreground">{s.label}: {s.count} ({s.percent}%)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collection rate summary — formerly in Analytics tab */}
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 p-4">
          <Stat label="Revenu cumulé" value={formatDzd(totalRevenue, { compact: true })} tone="success" onClick={() => onDrillDown("revenue")} />
          <Stat label="Créances" value={formatDzd(totalDebt, { compact: true })} tone="danger" onClick={() => onDrillDown("debt")} />
          <Stat label="Taux de recouvrement" value={`${collectionRate}%`} tone="info" />
        </CardContent>
      </Card>

      {/* Calendar — embedded per spec §3.1 */}
      <DashboardCalendar />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "info";
  onClick?: () => void;
}) {
  const colors = {
    success: "text-status-success",
    danger: "text-status-danger",
    info: "text-status-info",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`space-y-1 text-start ${onClick ? "cursor-pointer hover:opacity-80" : ""}`}
      disabled={!onClick}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tnum ${colors[tone]}`}>{value}</p>
    </button>
  );
}
