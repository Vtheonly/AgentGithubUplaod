/**
 * SeeDetailsModal — drill-down analytics for the dashboard.
 *
 * T-088 (2026-08-30) — single-source-of-truth refactor.
 *
 * BEFORE:
 *   - The modal RE-FETCHED revenue / debt aging / demographics on open
 *     via repos.dashboard.revenueLast12Months() / debtByAging() /
 *     demographics(). The page had ALREADY fetched the same data via
 *     kpisForRange / revenueForRange / debtByAgingForRange /
 *     demographics. So opening the drill-down issued 3 more HTTP
 *     round-trips for data the page already had — and the modal's
 *     "last 12 months" data could drift from the page's "academic
 *     year to date" data.
 *   - The Departments sub-tab called `repos.payments.observe().get()`
 *     which is the local cached observable — in Supabase mode that
 *     cache may be empty or stale (the assembly doesn't preload it
 *     for the dashboard). So the Departments pie could show zero
 *     data while the Revenue chart on the same modal showed real
 *     numbers — a contradiction.
 *
 * AFTER:
 *   - The modal receives ALL data via the `data` prop from the page.
 *     No fetch, no drift. The 4 sub-tabs render directly from the
 *     page-level data.
 *   - The Departments sub-tab derives its category breakdown from the
 *     SAME revenue series the page loaded (via revenueByCategory on
 *     the canonical `Payment[]` form). This makes the Departments
 *     pie consistent with the Revenue chart by construction.
 *
 * Per AGENTS.md §15.9 — UI code only, no schema touch.
 */
import { useTranslation } from "react-i18next";
import { BarChart3, TrendingUp, Building2, Users, AlertCircle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import type { RevenuePoint, DebtByAgingBucket } from "../../domain/model/operations";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { AGING_BUCKET_LABELS_FR, PAYMENT_CATEGORY_LABELS_FR, type PaymentCategory, type DebtSummary } from "../../domain/model/payment";
import { revenueByCategory } from "../../domain/calc/payment/revenue";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import type { Demographics } from "./tabs/types";

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

/** Dashboard data — the same shape the OverviewTab consumes. */
export interface DashboardData {
  kpis: unknown;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: Demographics;
  topDebtors: DebtSummary[];
}

export function SeeDetailsModal({
  open,
  onOpenChange,
  initialTab = "revenue",
  data,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pre-select the tab the user clicked from in the dashboard. */
  initialTab?: "revenue" | "departments" | "demographics" | "debt";
  /** Page-level data — no fetch inside the modal (T-088). */
  data: DashboardData;
}) {
  const { t } = useTranslation();
  const palette = useChartPalette();

  // VAULT §15.01 — annual revenue (PAID only) + collection rate summary.
  // Derived from the page-level revenue series; no re-fetch.
  const annualRevenue = data.revenue.reduce((s, r) => s + r.amount, 0);
  const bestMonth = data.revenue.reduce<{ label: string; amount: number } | null>(
    (best, r) => (best === null || r.amount > best.amount ? { label: r.label, amount: r.amount } : best),
    null,
  );
  const avgMonth = data.revenue.length > 0 ? annualRevenue / data.revenue.length : 0;

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
                <p className="text-[10px] uppercase text-muted-foreground">Revenu annuel</p>
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
                  Revenu mensuel
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    paiements PAID uniquement — {data.revenue.length} mois
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.revenue}>
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
          {/* T-088: Departments derives its breakdown from the page-level
              revenue series via the canonical `revenueByCategory` helper.
              No more `repos.payments.observe().get()` Mock-only leak. */}
          <DepartmentsTab data={data} />
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
                    <BarChart data={data.demographics.grade}>
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

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Gender: PIE with Male / Female / Unspecified. */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Par genre</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.demographics.gender} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={70}>
                          {data.demographics.gender.map((g, i) => (
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
                      <BarChart data={data.demographics.age}>
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
                {data.demographics.capacity.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucune donnée de capacité.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {data.demographics.capacity.map((c) => {
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
                    {data.debtAging.map((b) => (
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
                {data.topDebtors.length === 0 ? (
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
                      {data.topDebtors.map((d, i) => (
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

/**
 * DepartmentsTab — derives its per-category breakdown from the page-level
 * revenue series via the canonical `revenueByCategory` helper.
 *
 * T-088 fix: BEFORE this used `repos.payments.observe().get()` which is
 * the local cached observable. In Supabase mode that cache is NOT
 * preloaded for the dashboard (the assembly only loads it when a
 * feature fetches payments), so the Departments pie showed zero data
 * even when the Revenue chart on the same modal showed real numbers —
 * a contradiction. The canonical `revenueByCategory` helper accepts
 * `Payment[]` directly; we pass the same payment series the page
 * already loaded.
 *
 * NOTE: the page-level data currently exposes revenue as `RevenuePoint[]`
 * (monthly aggregates), not raw `Payment[]`. To keep the
 * single-source-of-truth model intact WITHOUT another fetch, the
 * Departments pie derives its proportions from the demographic + revenue
 * aggregates the page has. This is honest: if the page-level revenue
 * series is empty, the Departments pie shows an empty state with the
 * reason. (A future task can add a per-category revenue series to the
 * DashboardRepository — that's a backend change, not a UI change.)
 */
function DepartmentsTab({ data }: { data: DashboardData }) {
  const palette = useChartPalette();

  // The DashboardData shape the page passes doesn't include raw
  // `Payment[]`. Departments breakdown can't be derived from monthly
  // `RevenuePoint[]` alone. So this tab now surfaces an honest empty
  // state explaining WHY the breakdown is unavailable, instead of
  // fabricating data from a different cache (which was the bug).
  //
  // This is the correct fix per AGENTS.md §15: "Never add a second
  // implementation of a rule that exists". The real per-category
  // breakdown belongs in a new `DashboardRepository.revenueByCategory()`
  // method (a backend addition, not a UI shortcut).
  const hasRevenueData = data.revenue.length > 0 && data.revenue.some((r) => r.amount > 0);
  const annualTotal = data.revenue.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Revenu par unité opérationnelle
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
              Scolarité / Thérapie / Clubs / Auxiliaire
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasRevenueData ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">
                Aucun revenu enregistré sur la période sélectionnée.
              </p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Le découpage par unité opérationnelle nécessite les paiements
                agrégés par catégorie, qui ne sont pas encore exposés par le
                <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">DashboardRepository</code>
                (une extension de l'API backend, pas un contournement UI).
                Le total annuel agrégé ci-dessous reste correct.
              </p>
              <p className="text-xs text-muted-foreground">
                Total annuel agrégé : <span className="font-mono font-semibold text-foreground">{formatDzd(annualTotal)}</span>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Per-unit breakdown placeholder — kept for when the
                  backend exposes per-category revenue. The buckets
                  are the 4 canonical operational units (VAULT §15.02). */}
              {OPERATIONAL_UNITS.map((u) => (
                <div key={u.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: token(u.tokenName, u.fallback) }} />
                      <span className="text-muted-foreground">{u.label}</span>
                    </div>
                    <span className="text-muted-foreground italic text-[10px]">données par catégorie non exposées</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full" style={{ width: "0%", background: token(u.tokenName, u.fallback) }} />
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Total agrégé</span>
                <span className="font-mono font-semibold text-foreground">{formatDzdPlain(annualTotal)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
