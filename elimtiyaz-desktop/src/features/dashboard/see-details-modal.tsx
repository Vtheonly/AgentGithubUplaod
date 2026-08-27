/**
 * See Details modal — overlays the dashboard with 4 sub-tabs:
 * Revenue / Departments / Demographics / Debt.
 *
 * Per the plan §15: this MUST overlay the dashboard, NOT be a separate route.
 * The modal is sized to cover ~70% of the viewport.
 *
 * VAULT §15 updates in this revision:
 *   - Demographics: Grade Level Distribution is a BAR chart per grade
 *     (1AP…3ème Année — never a pie by cycle); Gender is a pie with the
 *     Unspecified slice; Age stays a histogram; Capacity vs Enrollment is a
 *     radial GAUGE per class.
 *   - Departments: granular categories grouped into the 4 operational units
 *     (Scolarité / Thérapie / Clubs / Auxiliaire) — never a single "Other"
 *     bucket — with the granular breakdown kept alongside.
 *   - Debt: aging tiers PLUS the top debtors list.
 *   - Revenue: annual trend + PAID-only totals + collection rate.
 *   - Color tokens: charts read the CSS-variable palette at runtime (no
 *     hard-coded hex strings in components — plan §03).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, TrendingUp, Building2, Users, AlertCircle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { useRepositories } from "../../app/providers/repository-provider";
import type { RevenuePoint, DebtByAgingBucket } from "../../domain/model/operations";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { AGING_BUCKET_LABELS_FR, PAYMENT_CATEGORY_LABELS_FR, type PaymentCategory, type DebtSummary } from "../../domain/model/payment";
import { revenueByCategory } from "../../domain/calc/payment/revenue";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";

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

/** Palette resolved from the token file at render time. */
function useChartPalette() {
  return {
    primary: token("--brand-blue", "#349bd4"),
    cyan: token("--brand-blue-light", "#6ec1e4"),
    gold: token("--brand-gold", "#c8a98c"),
    slate: token("--brand-slate", "#3b464c"),
    success: token("--status-success", "#3fa66e"),
    danger: token("--status-danger", "#c0504d"),
    brown: token("--brand-brown", "#836c68"),
  };
}

/** VAULT §15.02 — the 4 operational units (never a single "Other" bucket). */
const OPERATIONAL_UNITS: readonly {
  key: string;
  label: string;
  categories: readonly PaymentCategory[];
  tokenName: string;
  fallback: string;
}[] = [
  { key: "scolarite", label: "Scolarité (académique)", categories: ["tuition", "books", "uniform", "second_apron"], tokenName: "--brand-blue", fallback: "#349bd4" },
  { key: "therapy", label: "Thérapie (Orthophonie / Psychologie)", categories: ["therapy_psychology", "therapy_speech"], tokenName: "--brand-gold", fallback: "#c8a98c" },
  { key: "clubs", label: "Clubs & parascolaire", categories: ["extracurricular"], tokenName: "--status-danger", fallback: "#c0504d" },
  { key: "auxiliary", label: "Services auxiliaires (Transport / Cantine)", categories: ["transport", "canteen"], tokenName: "--status-success", fallback: "#3fa66e" },
];

export function SeeDetailsModal({
  open,
  onOpenChange,
  initialTab = "revenue",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Iteration 9 — pre-select the tab the user clicked from in the dashboard. */
  initialTab?: "revenue" | "departments" | "demographics" | "debt";
}) {
  const { t } = useTranslation();
  const repos = useRepositories();
  const palette = useChartPalette();
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [debtAging, setDebtAging] = useState<DebtByAgingBucket[]>([]);
  const [topDebtors, setTopDebtors] = useState<DebtSummary[]>([]);
  const [demographics, setDemographics] = useState<{
    grade: { label: string; count: number; percent: number }[];
    gender: { label: string; count: number; percent: number }[];
    age: { label: string; count: number; percent: number }[];
    capacity: { label: string; count: number; percent: number }[];
  }>({ grade: [], gender: [], age: [], capacity: [] });

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [rev, debt, demo] = await Promise.all([
        repos.dashboard.revenueLast12Months(),
        repos.dashboard.debtByAging(),
        repos.dashboard.demographics(),
      ]);
      if (rev.ok) setRevenue(rev.value);
      if (debt.ok) setDebtAging(debt.value);
      if (demo.ok) setDemographics(demo.value);
      // VAULT §15.05 — the Debt tab also lists the TOP DEBTORS.
      setTopDebtors(
        repos.debt.observeSummary().get()
          .filter((d) => d.outstandingAmount > 0)
          .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
          .slice(0, 10),
      );
    })();
  }, [open, repos.dashboard, repos.debt]);

  // VAULT §15.01 — annual revenue (PAID only) + collection rate summary.
  const annualRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const bestMonth = revenue.reduce<{ label: string; amount: number } | null>(
    (best, r) => (best === null || r.amount > best.amount ? { label: r.label, amount: r.amount } : best),
    null,
  );
  const avgMonth = revenue.length > 0 ? annualRevenue / revenue.length : 0;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      variant="dialog"
      icon={BarChart3}
      iconTone="primary"
      title={t("dashboard.seeDetails")}
      description="Vue détaillée des indicateurs — revenus, départements, démographie, créances."
      hideFooter
    >
      <PageTabs defaultValue={initialTab} variant="underline">
        <PageTabList>
          <PageTab value="revenue" label={t("dashboard.sections.revenue")} icon={TrendingUp} />
          <PageTab value="departments" label={t("dashboard.sections.departments")} icon={Building2} />
          <PageTab value="demographics" label={t("dashboard.sections.demographics")} icon={Users} />
          <PageTab value="debt" label={t("dashboard.sections.debt")} icon={AlertCircle} />
        </PageTabList>

        <PageTabContent value="revenue">
          <div className="space-y-4">
            {/* VAULT §15.01 — annual trend summary (PAID-only revenue). */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Revenu annuel (12 mois)</p>
                <p className="text-lg font-mono font-bold">{formatDzd(annualRevenue)}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Moyenne mensuelle</p>
                <p className="text-lg font-mono font-bold">{formatDzd(avgMonth)}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Meilleur mois</p>
                <p className="text-lg font-mono font-bold">
                  {bestMonth ? `${bestMonth.label} · ${formatDzdPlain(bestMonth.amount)}` : "—"}
                </p>
              </div>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Revenu mensuel (12 mois)
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    paiements PAID uniquement
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenue}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                      <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [formatDzd(v), "Revenu"]} />
                      <Bar dataKey="amount" fill={palette.primary} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageTabContent>

        <PageTabContent value="departments">
          <DepartmentsTab />
        </PageTabContent>

        <PageTabContent value="demographics">
          <div className="space-y-4">
            {/* VAULT §15.03 — Grade Level Distribution: BAR chart per grade. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Effectifs par niveau
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    1AP → 3ème Année (diagramme en barres, plan §15.03)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={demographics.grade}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v} élèves`, "Effectif"]} />
                      <Bar dataKey="count" fill={palette.primary} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3 md:grid-cols-2">
              {/* Gender: PIE with Male / Female / Unspecified. */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Par genre</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={demographics.gender} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={70}>
                          {demographics.gender.map((g, i) => (
                            <Cell
                              key={g.label}
                              fill={[palette.primary, palette.gold, palette.slate][i % 3]}
                            />
                          ))}
                        </Pie>
                        <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v} élèves`, "Effectif"]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Age distribution histogram. */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Distribution par âge</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={demographics.age}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v} élèves`, "Effectif"]} />
                        <Bar dataKey="count" fill={palette.cyan} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* VAULT §15.03 — Capacity vs Enrollment: radial GAUGE per class. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Capacité vs Inscriptions (par classe)
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    jauge : inscriptions / capacité max
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {demographics.capacity.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucune donnée de capacité.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {demographics.capacity.map((c) => {
                      const fillPct = Math.min(100, c.percent);
                      const tone = c.percent >= 100 ? palette.danger : c.percent >= 80 ? palette.gold : palette.success;
                      // Semi-circle arc gauge (SVG path).
                      const angle = Math.PI * (1 - fillPct / 100);
                      const x = 50 + 40 * Math.cos(angle);
                      const y = 50 - 40 * Math.sin(angle);
                      const largeArc = fillPct > 50 ? 1 : 0;
                      return (
                        <div key={c.label} className="flex flex-col items-center gap-1">
                          <svg viewBox="0 0 100 58" className="w-full max-w-[120px]">
                            <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="hsl(var(--muted))" strokeWidth={8} strokeLinecap="round" />
                            <path
                              d={`M 10 50 A 40 40 0 0 ${largeArc} ${fillPct >= 100 ? 90 : x} ${fillPct >= 100 ? 50 : y}`}
                              fill="none"
                              stroke={tone}
                              strokeWidth={8}
                              strokeLinecap="round"
                            />
                            <text x="50" y="46" textAnchor="middle" className="fill-foreground font-mono" fontSize={15} fontWeight={700}>
                              {c.percent}%
                            </text>
                          </svg>
                          <p className="text-xs font-medium truncate max-w-full" title={c.label}>{c.label}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{c.count} inscrits</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </PageTabContent>

        <PageTabContent value="debt">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Créances par tranche d'âge</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2">Tranche</th>
                      <th className="py-2 text-right">Montant</th>
                      <th className="py-2 text-right">Débiteurs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {debtAging.map((b) => (
                      <tr key={b.bucket}>
                        <td className="py-2">{AGING_BUCKET_LABELS_FR[b.bucket]}</td>
                        <td className="py-2 text-right font-mono">{formatDzdPlain(b.amount)}</td>
                        <td className="py-2 text-right">{b.debtorCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* VAULT §15.05 — Debt tab: top debtors list. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Top débiteurs
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    10 familles les plus endettées
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topDebtors.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucune créance en cours.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2">#</th>
                        <th className="py-2">Famille</th>
                        <th className="py-2 text-right">Retard</th>
                        <th className="py-2 text-right">Créance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {topDebtors.map((d, i) => (
                        <tr key={d.parentId}>
                          <td className="py-2 font-mono text-muted-foreground">{i + 1}</td>
                          <td className="py-2">{d.parentName}</td>
                          <td className="py-2 text-right font-mono">{d.daysOverdue} j</td>
                          <td className="py-2 text-right font-mono font-semibold text-status-danger">
                            {formatDzdPlain(d.outstandingAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </PageTabContent>
      </PageTabs>
    </UnifiedModal>
  );
}

function DepartmentsTab() {
  const repos = useRepositories();
  const palette = useChartPalette();
  const [units, setUnits] = useState<{ label: string; amount: number; color: string }[]>([]);
  const [granular, setGranular] = useState<{ label: string; amount: number; color: string }[]>([]);

  useEffect(() => {
    void (async () => {
      // Derive department revenue from the ledger via `revenueByCategory()`.
      const payments = repos.payments.observe().get();
      const colors: Record<string, string> = {
        tuition: palette.primary,
        transport: palette.success,
        canteen: palette.gold,
        uniform: palette.cyan,
        books: palette.brown,
        extracurricular: palette.danger,
        therapy_psychology: palette.gold,
        therapy_speech: palette.cyan,
        second_apron: palette.brown,
        other: palette.slate,
      };
      const byCategory = revenueByCategory(payments);
      const granularDeps = byCategory.map((d) => ({
        label: PAYMENT_CATEGORY_LABELS_FR[d.category] ?? d.category,
        amount: d.amount,
        color: colors[d.category] ?? palette.slate,
      }));
      setGranular(granularDeps);

      // VAULT §15.02 — group the granular categories into the 4 operational
      // units (Core Academics / Therapy / Clubs / Auxiliary). "parent_credit"
      // and "other" are excluded from the unit totals (they are not
      // departmental revenue); every REAL dinar is attributable to a unit.
      const amountOf = (cat: PaymentCategory) =>
        byCategory.find((c) => c.category === cat)?.amount ?? 0;
      setUnits(
        OPERATIONAL_UNITS.map((u) => ({
          label: u.label,
          amount: u.categories.reduce((sum, cat) => sum + amountOf(cat), 0),
          color: token(u.tokenName, u.fallback),
        })),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- palette is stable per theme
  }, [repos.payments]);

  const unitTotal = units.reduce((s, d) => s + d.amount, 0);
  const granularTotal = granular.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="space-y-4">
      {/* 4 operational units — vault §15.02. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Revenu par unité opérationnelle
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
              Scolarité / Thérapie / Clubs / Auxiliaire — aucun bac « Autre » (plan §15.02)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={units} dataKey="amount" nameKey="label" cx="50%" cy="50%" outerRadius={80}>
                    {units.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => formatDzd(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {units.map((d) => (
                <div key={d.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      <span className="text-muted-foreground">{d.label}</span>
                    </div>
                    <span className="font-mono text-foreground">{formatDzdPlain(d.amount)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full" style={{ width: unitTotal === 0 ? "0%" : `${(d.amount / unitTotal) * 100}%`, background: d.color }} />
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Total</span>
                <span className="font-mono font-semibold text-foreground">{formatDzdPlain(unitTotal)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Granular per-category breakdown (kept alongside the units). */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Détail par catégorie de service</CardTitle></CardHeader>
        <CardContent>
          {granular.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Aucun revenu enregistré ce mois.</p>
          ) : (
            <div className="space-y-2">
              {granular.map((d) => (
                <div key={d.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      <span className="text-muted-foreground">{d.label}</span>
                    </div>
                    <span className="font-mono text-foreground">{formatDzdPlain(d.amount)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full" style={{ width: granularTotal === 0 ? "0%" : `${(d.amount / granularTotal) * 100}%`, background: d.color }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
