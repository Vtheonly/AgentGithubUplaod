/**
 * See Details modal — overlays the dashboard with 4 sub-tabs:
 * Revenue / Departments / Demographics / Debt.
 *
 * Per the plan §15: this MUST overlay the dashboard, NOT be a separate route.
 * The modal is sized to cover ~70% of the viewport.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { useRepositories } from "../../infrastructure/repository-provider";
import type { RevenuePoint, DebtByAgingBucket } from "../../domain/model/operations";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { AGING_BUCKET_LABELS_FR } from "../../domain/model/payment";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../shared/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../shared/ui/tabs";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t("dashboard.seeDetails")}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="revenue">
          <TabsList variant="pill">
            <TabsTrigger value="revenue">{t("dashboard.sections.revenue")}</TabsTrigger>
            <TabsTrigger value="departments">{t("dashboard.sections.departments")}</TabsTrigger>
            <TabsTrigger value="demographics">{t("dashboard.sections.demographics")}</TabsTrigger>
            <TabsTrigger value="debt">{t("dashboard.sections.debt")}</TabsTrigger>
          </TabsList>

          <TabsContent value="revenue" className="mt-4">
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
          </TabsContent>

          <TabsContent value="departments" className="mt-4">
            <DepartmentsTab />
          </TabsContent>

          <TabsContent value="demographics" className="mt-4">
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
          </TabsContent>

          <TabsContent value="debt" className="mt-4">
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentsTab() {
  // Mock department breakdown
  const departments = [
    { label: "Scolarité (Tuition)", amount: 1_580_000, color: "#349BD4" },
    { label: "Therapy (Orthophonie/Psychologie)", amount: 145_000, color: "#6EC1E4" },
    { label: "Clubs (Échecs, Anglais, Sport)", amount: 92_000, color: "#C8A98C" },
    { label: "Auxiliaire (Transport, Cantine)", amount: 268_000, color: "#3FA66E" },
  ];
  const total = departments.reduce((s, d) => s + d.amount, 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Revenu par département</CardTitle></CardHeader>
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
                  <div className="h-full" style={{ width: `${(d.amount / total) * 100}%`, background: d.color }} />
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
