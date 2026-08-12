/**
 * Reports tab — GLOBAL macro reports only (per spec §5.1)
 *
 * Entity-specific reports live in profile drawers (per spec §5.2).
 *
 * Extracted from `dashboard-page.tsx` (Task 2-a). Behavior is preserved
 * exactly — only file location and imports changed.
 */
import { useState } from "react";
import {
  Users,
  Wallet,
  AlertTriangle,
  TrendingUp,
  ScrollText,
  Loader2,
  FileText,
  Download,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useToast } from "../../../app/providers/toast-provider";
import {
  exportRevenueReport, exportOutstandingDebtReport, exportStudentRoster,
} from "../../../infrastructure/excel/reports";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";

export function ReportsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const [exporting, setExporting] = useState<string | null>(null);

  // Iteration 9: ONLY macro / organization-level aggregate reports.
  // Entity-specific reports (relevé-enseignant, releve-notes, bulletins,
  // paiements-jour) have been relocated to their respective profile drawers.
  const reports = [
    {
      code: "revenu-mensuel",
      title: "Revenu mensuel",
      desc: "Excel multi-feuilles: synthèse, par méthode, par catégorie, transactions.",
      icon: TrendingUp,
      formats: ["XLSX", "PDF"] as const,
    },
    {
      code: "creances-agees",
      title: "Créances par tranche d'âge",
      desc: "XLSX: famille, élève, montant, tranche 0-30/31-60/61-90+.",
      icon: AlertTriangle,
      formats: ["XLSX"] as const,
    },
    {
      code: "effectifs-niveau",
      title: "Effectifs par niveau",
      desc: "XLSX: répartition Primaire / CEM / Lycée, code par code.",
      icon: Users,
      formats: ["XLSX"] as const,
    },
    {
      code: "journal-audit",
      title: "Journal d'audit",
      desc: "Voir Settings → Audit. Filtrable par acteur, action, entité, plage de dates.",
      icon: ScrollText,
      formats: ["Voir Settings"] as const,
    },
    {
      code: "depenses-categorie",
      title: "Dépenses par catégorie",
      desc: "XLSX: agrégat mensuel par catégorie contrôlée.",
      icon: Wallet,
      formats: ["XLSX"] as const,
    },
    {
      code: "annuaire-personnel",
      title: "Annuaire du personnel",
      desc: "XLSX: nom, catégorie, contact, statut.",
      icon: Users,
      formats: ["XLSX"] as const,
    },
  ];

  async function handleExport(code: string, format: "XLSX" | "PDF") {
    setExporting(`${code}-${format}`);
    try {
      if (code === "revenu-mensuel" && format === "XLSX") {
        const payments = repos.payments.observe().get();
        const today = new Date();
        const from = new Date(today);
        from.setMonth(from.getMonth() - 12);
        await exportRevenueReport(payments, {
          from: from.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
        });
      } else if (code === "revenu-mensuel" && format === "PDF") {
        // For now, generate a PDF version of the same data via the receipts engine.
        // (Iteration 9: minimal PDF report — just a styled summary.)
        toast.showInfo("PDF en préparation", "Le PDF du revenu mensuel sera disponible prochainement.");
        return;
      } else if (code === "creances-agees") {
        const summary = repos.debt.observeSummary().get();
        await exportOutstandingDebtReport(
          summary
            .filter((d) => d.outstandingAmount > 0)
            .map((d) => ({
              parentCode: d.parentId,
              parentName: d.parentName,
              parentPhone: "",
              bucket: d.bucket as "0_30" | "31_60" | "61_90" | "91_180" | "180_plus",
              daysOverdue: d.daysOverdue,
              outstandingAmount: d.outstandingAmount,
            })),
          "xlsx",
        );
      } else if (code === "effectifs-niveau") {
        const students = repos.students.observe().get();
        await exportStudentRoster(students);
      } else if (code === "annuaire-personnel") {
        const personnel = repos.personnel.observe().get();
        if (personnel.length === 0) {
          toast.showWarning("Aucun personnel", "Rien à exporter.");
          return;
        }
        const { exportToXlsx } = await import("../../../infrastructure/excel/export-engine");
        const { STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR } = await import("../../../domain/model/personnel");
        const columns = [
          { header: "Code", key: "code", width: 14 },
          { header: "Prénom", key: "firstName", width: 16 },
          { header: "Nom", key: "lastName", width: 18 },
          { header: "Catégorie", key: "category", width: 18 },
          { header: "Téléphone", key: "phone", width: 18 },
          { header: "E-mail", key: "email", width: 28 },
          { header: "Date d'embauche", key: "hireDate", width: 14 },
          { header: "Statut", key: "status", width: 14 },
          { header: "Heures hebdo. cibles", key: "weeklyHoursTarget", width: 14 },
          { header: "Heures hebdo. effectuées", key: "weeklyHoursLogged", width: 14 },
          { header: "Salaire (DZD)", key: "salary", width: 16 },
        ];
        const rows = personnel.map((p) => ({
          code: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          category: STAFF_CATEGORY_LABELS_FR[p.staffCategory],
          phone: p.phone,
          email: p.email ?? "",
          hireDate: p.hireDate,
          status: PERSONNEL_STATUS_LABELS_FR[p.status],
          weeklyHoursTarget: p.weeklyHoursTarget,
          weeklyHoursLogged: p.weeklyHoursLogged,
          salary: p.salary != null ? new Intl.NumberFormat("fr-FR").format(p.salary) : "—",
        }));
        exportToXlsx(
          [{ name: "Personnel", columns, rows }],
          `annuaire-personnel-${new Date().toISOString().slice(0, 10)}.xlsx`,
        );
        toast.showSuccess("Export XLSX", `${personnel.length} personnel(s) exporté(s).`);
        return;
      } else if (code === "depenses-categorie") {
        const { exportToXlsx } = await import("../../../infrastructure/excel/export-engine");
        const expenses = repos.expenses.observe().get();
        const byCategory = new Map<string, number>();
        for (const e of expenses) {
          byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
        }
        const columns = [
          { header: "Catégorie", key: "category", width: 24 },
          { header: "Montant total (DZD)", key: "amount", width: 20 },
          { header: "Nombre de dépenses", key: "count", width: 18 },
        ];
        const rows = Array.from(byCategory.entries()).map(([cat, amount]) => ({
          category: cat,
          amount: new Intl.NumberFormat("fr-FR").format(amount),
          count: expenses.filter((e) => e.category === cat).length,
        }));
        exportToXlsx(
          [{ name: "Dépenses par catégorie", columns, rows }],
          `depenses-categorie-${new Date().toISOString().slice(0, 10)}.xlsx`,
        );
        toast.showSuccess("Export XLSX", `${byCategory.size} catégories exportées.`);
        return;
      } else {
        toast.showInfo("Bientôt disponible", `Le rapport "${code}" sera disponible prochainement.`);
        return;
      }
      toast.showSuccess("Export généré", `Le rapport ${code} a été téléchargé.`);
    } catch (e) {
      toast.showError("Échec de l'export", e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">
          <FileText className="inline h-3 w-3 mr-1" />
          <strong>Rapports globaux uniquement.</strong>{" "}
          Les rapports individuels (bulletins, relevés de compte, fiches de paie) sont générés
          directement depuis le profil de l'entité concernée (élève, parent, personnel).
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {reports.map((r) => {
          const Icon = r.icon;
          const isReady = ["revenu-mensuel", "creances-agees", "effectifs-niveau", "annuaire-personnel", "depenses-categorie"].includes(r.code);
          return (
            <Card key={r.code} className="hover:border-primary/50 transition-colors">
              <CardContent className="flex items-start justify-between p-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{r.title}</p>
                      {r.formats.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {r.formats.map((f) => {
                    if (f === "Voir Settings") {
                      return (
                        <Button
                          key={f}
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => window.location.assign("/#/settings?tab=audit")}
                        >
                          Ouvrir
                        </Button>
                      );
                    }
                    return (
                      <Button
                        key={f}
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        title={isReady ? `Télécharger ${f}` : "Bientôt disponible"}
                        disabled={!isReady || exporting === `${r.code}-${f}`}
                        onClick={() => handleExport(r.code, f)}
                      >
                        {exporting === `${r.code}-${f}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1">{f}</span>
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
