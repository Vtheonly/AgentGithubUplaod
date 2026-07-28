/**
 * See Details modal — overlays the dashboard with 4 sub-tabs:
 * Revenue / Departments / Demographics / Debt.
 *
 * Per the plan §15: this MUST overlay the dashboard, NOT be a separate route.
 * The modal is sized to cover ~70% of the viewport.
 *
 * Iteration 3: refactored to use UnifiedModal (variant="dialog", hideFooter)
 * and the PageTabs primitive (variant="underline") for a more modern,
 * polished appearance that matches the rest of the application.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, TrendingUp, Building2, Users, AlertCircle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { useRepositories } from "../../infrastructure/repository-provider";
import type { RevenuePoint, DebtByAgingBucket } from "../../domain/model/operations";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { AGING_BUCKET_LABELS_FR, PAYMENT_CATEGORY_LABELS_FR, revenueByCategory } from "../../domain/model/payment";
import { UnifiedModal } from "../../shared/components/unified-modal";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";

export function SeeDetailsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const repos = useRepositories();
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [debtAging, setDebtAging] = useState<DebtByAgingBucket[]>([]);
  const [demographics, setDemographics] = useState<{ grade: { label: string; count: number; percent: number }[]; gender: { label: string; count: number; percent: number }[] }>({ grade: [], gender: [] });

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
    })();
  }, [open, repos.dashboard]);

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
      <PageTabs defaultValue="revenue" variant="underline">
        <PageTabList>
          <PageTab value="revenue" label={t("dashboard.sections.revenue")} icon={TrendingUp} />
          <PageTab value="departments" label={t("dashboard.sections.departments")} icon={Building2} />
          <PageTab value="demographics" label={t("dashboard.sections.demographics")} icon={Users} />
          <PageTab value="debt" label={t("dashboard.sections.debt")} icon={AlertCircle} />
        </PageTabList>

        <PageTabContent value="revenue">
          <Card>
            <CardHeader><CardTitle className="text-sm">Revenu mensuel (12 mois)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [formatDzd(v), "Revenu"]} />
                    <Bar dataKey="amount" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </PageTabContent>

        <PageTabContent value="departments">
          <DepartmentsTab />
        </PageTabContent>

        <PageTabContent value="demographics">
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Par niveau</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={demographics.grade} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={70}>
                        {demographics.grade.map((_, i) => (
                          <Cell key={i} fill={["#349BD4", "#6EC1E4", "#C8A98C"][i % 3]} />
                        ))}
                      </Pie>
                      <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Par genre</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={demographics.gender} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={70}>
                        {demographics.gender.map((_, i) => (
                          <Cell key={i} fill={["#349BD4", "#C8A98C"][i % 2]} />
                        ))}
                      </Pie>
                      <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageTabContent>

        <PageTabContent value="debt">
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
        </PageTabContent>
      </PageTabs>
    </UnifiedModal>
  );
}

function DepartmentsTab() {
  const repos = useRepositories();
  const [departments, setDepartments] = useState<{ label: string; amount: number; color: string }[]>([]);

  useEffect(() => {
    void (async () => {
      // Iteration 5: derive department revenue from the ledger via
      // `revenueByCategory()` — no more hardcoded amounts.
      const payments = repos.payments.observe().get();
      const colors: Record<string, string> = {
        tuition: "#349BD4",
        transport: "#3FA66E",
        canteen: "#C8A98C",
        uniform: "#6EC1E4",
        books: "#836C68",
        extracurricular: "#C0504D",
        other: "#3B464C",
      };
      const byCategory = revenueByCategory(payments);
      const deps = byCategory.map((d) => ({
        label: PAYMENT_CATEGORY_LABELS_FR[d.category] ?? d.category,
        amount: d.amount,
        color: colors[d.category] ?? "#3B464C",
      }));
      // If no data this month, show all categories with 0.
      if (deps.length === 0) {
        setDepartentsEmpty(setDepartments, colors, PAYMENT_CATEGORY_LABELS_FR);
        return;
      }
      setDepartments(deps);
    })();
  }, [repos.payments]);

  const total = departments.reduce((s, d) => s + d.amount, 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Revenu par département (mois en cours)</CardTitle></CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={departments} dataKey="amount" nameKey="label" cx="50%" cy="50%" outerRadius={80}>
                  {departments.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => formatDzd(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {departments.map((d) => (
              <div key={d.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                    <span className="text-muted-foreground">{d.label}</span>
                  </div>
                  <span className="font-mono text-foreground">{formatDzdPlain(d.amount)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full" style={{ width: total === 0 ? "0%" : `${(d.amount / total) * 100}%`, background: d.color }} />
                </div>
              </div>
            ))}
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total</span>
              <span className="font-mono font-semibold text-foreground">{formatDzdPlain(total)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function setDepartentsEmpty(
  set: (deps: { label: string; amount: number; color: string }[]) => void,
  colors: Record<string, string>,
  labels: Record<string, string>,
) {
  set(["tuition", "transport", "canteen", "extracurricular"].map((cat) => ({
    label: labels[cat] ?? cat,
    amount: 0,
    color: colors[cat] ?? "#3B464C",
  })));
}
