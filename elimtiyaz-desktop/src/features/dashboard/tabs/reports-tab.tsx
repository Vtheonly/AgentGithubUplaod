// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/reports-tab.tsx
// ============================================================================

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
  Database,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { AuditActions } from "../../../core/audit-actions";
import {
  exportRevenueReport,
  exportOutstandingDebtReport,
  exportStudentRoster,
} from "../../../infrastructure/excel/reports";
import { exportFullWorkbook } from "../../../infrastructure/excel/full-export";
import {
  generateRevenueReportPdf,
  generateOutstandingDebtReportPdf,
  generateStudentRosterPdf,
  generatePersonnelDirectoryPdf,
  generateExpensesByCategoryPdf,
} from "../../../infrastructure/receipt-pdf/global-reports";
import { downloadPdf } from "../../../infrastructure/receipt-pdf/download";
import type { PricingConfig } from "../../../domain/model/pricing";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";

export function ReportsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [exporting, setExporting] = useState<string | null>(null);

  const payments = useObservable(() => repos.payments.observe(), []);
  const debtSummaries = useObservable(() => repos.debt.observeSummary(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const expenses = useObservable(() => repos.expenses.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);

  const installments = useObservable(() => repos.installments.observe(), []);
  const ledger = useObservable(() => repos.ledger.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const assessments = useObservable(() => repos.grades.observeAll(), []);
  const attendance = useObservable(
    () => repos.attendance.observeAll("2020-01-01", "2030-12-31"),
    [],
  );
  const pricing = useObservable(() => repos.pricing.observe(), []);

  const pricingValue: PricingConfig | null =
    pricing &&
    (Object.keys(pricing.tuitionByGradeLevel ?? {}).length > 0 ||
      Object.keys(pricing.monthlyByLevel ?? {}).length > 0 ||
      (pricing.registrationFee ?? 0) > 0)
      ? pricing
      : null;

  const standardReports = [
    {
      code: "revenu-mensuel",
      title: "Rapport d'Encaissements Mensuels",
      desc: "Historique complet, ventilation par canal de paiement et ventilation par pôle tarifaire.",
      icon: TrendingUp,
      formats: ["XLSX", "PDF"] as const,
      color: "var(--brand-blue, #349bd4)",
    },
    {
      code: "creances-agees",
      title: "Balance Âgée des Créances",
      desc: "Recensement exhaustif des impayés par famille, coordonnées, jours de retard et sévérité.",
      icon: AlertTriangle,
      formats: ["XLSX", "PDF"] as const,
      color: "var(--status-danger, #ef4444)",
    },
    {
      code: "effectifs-niveau",
      title: "Registre Global des Effectifs",
      desc: "Fichier central des élèves, répartition par cycle, palier académique et classe d'affectation.",
      icon: Users,
      formats: ["XLSX", "PDF"] as const,
      color: "var(--brand-cyan, #3dd6d0)",
    },
    {
      code: "depenses-categorie",
      title: "Journal Analytique des Dépenses",
      desc: "État récapitulatif des décaissements ventilés par catégorie de frais d'exploitation.",
      icon: Wallet,
      formats: ["XLSX", "PDF"] as const,
      color: "var(--brand-gold, #eab308)",
    },
    {
      code: "annuaire-personnel",
      title: "Annuaire du Personnel & Masse Salariale",
      desc: "Effectifs enseignants et personnel administratif, contrats, temps de travail et rémunérations.",
      icon: Users,
      formats: ["XLSX", "PDF"] as const,
      color: "var(--brand-violet, #8b5cf6)",
    },
    {
      code: "journal-audit",
      title: "Registre d'Audit & Traçabilité",
      desc: "Historique d'imputabilité des actions administratives. Accessible depuis Paramètres → Audit.",
      icon: ScrollText,
      formats: ["Voir Settings"] as const,
      color: "var(--brand-slate, #3b464c)",
    },
  ];

  async function handleExport(
    code: string,
    format: "XLSX" | "PDF" | "Voir Settings",
  ) {
    if (format === "Voir Settings") return;
    setExporting(`${code}-${format}`);

    try {
      let exportedRows: number | null = null;
      let fileName = "";

      if (code === "export-complet" && format === "XLSX") {
        fileName = await exportFullWorkbook({
          parents,
          students,
          personnel,
          payments,
          installments,
          ledger,
          expenses,
          assessments,
          subjects,
          attendance,
          debtSummaries,
          classes,
          pricing: pricingValue,
          exportedAt: new Date().toISOString(),
        });
        exportedRows =
          parents.length +
          students.length +
          payments.length +
          ledger.length +
          installments.length;
        toast.showSuccess("Export complet généré", fileName);
      } else if (code === "revenu-mensuel" && format === "XLSX") {
        const today = new Date();
        const from = new Date(today);
        from.setMonth(from.getMonth() - 12);
        await exportRevenueReport(payments, {
          from: from.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
        });
        exportedRows = payments.length;
      } else if (code === "revenu-mensuel" && format === "PDF") {
        const today = new Date();
        const from = new Date(today);
        from.setMonth(from.getMonth() - 12);
        const bytes = await generateRevenueReportPdf(payments, {
          from: from.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
        });
        fileName = `el-imtiyaz-revenu-${new Date().toISOString().slice(0, 10)}.pdf`;
        downloadPdf(bytes, fileName);
        exportedRows = payments.length;
        toast.showSuccess("Rapport PDF généré", fileName);
      } else if (code === "creances-agees" && format === "XLSX") {
        const rows = debtSummaries
          .filter((d) => d.outstandingAmount > 0)
          .map((d) => ({
            parentCode:
              parents.find((p) => p.id === d.parentId)?.code ?? d.parentId,
            parentName: d.parentName,
            parentPhone:
              d.parentPhone ||
              parents.find((p) => p.id === d.parentId)?.phone ||
              "",
            bucket: d.bucket as
              | "0_30"
              | "31_60"
              | "61_90"
              | "91_180"
              | "180_plus",
            daysOverdue: d.daysOverdue,
            outstandingAmount: d.outstandingAmount,
          }));
        await exportOutstandingDebtReport(rows, "xlsx");
        exportedRows = rows.length;
      } else if (code === "creances-agees" && format === "PDF") {
        const debtRows = debtSummaries
          .filter((d) => d.outstandingAmount > 0)
          .map((d) => ({
            parentCode:
              parents.find((p) => p.id === d.parentId)?.code ?? d.parentId,
            parentName: d.parentName,
            parentPhone:
              d.parentPhone ||
              parents.find((p) => p.id === d.parentId)?.phone ||
              "",
            bucket: d.bucket as string,
            daysOverdue: d.daysOverdue,
            outstandingAmount: d.outstandingAmount,
          }));
        const bytes = await generateOutstandingDebtReportPdf(debtRows);
        fileName = `el-imtiyaz-creances-${new Date().toISOString().slice(0, 10)}.pdf`;
        downloadPdf(bytes, fileName);
        exportedRows = debtRows.length;
        toast.showSuccess("Rapport PDF généré", fileName);
      } else if (code === "effectifs-niveau" && format === "XLSX") {
        await exportStudentRoster(students);
        exportedRows = students.length;
      } else if (code === "effectifs-niveau" && format === "PDF") {
        const bytes = await generateStudentRosterPdf(students);
        fileName = `el-imtiyaz-effectifs-${new Date().toISOString().slice(0, 10)}.pdf`;
        downloadPdf(bytes, fileName);
        exportedRows = students.length;
        toast.showSuccess("Rapport PDF généré", fileName);
      } else if (code === "annuaire-personnel" && format === "XLSX") {
        if (personnel.length === 0) {
          toast.showWarning("Aucun personnel", "Rien à exporter.");
          return;
        }
        const { exportToXlsx } =
          await import("../../../infrastructure/excel/export-engine");
        const { STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR } =
          await import("../../../domain/model/personnel");
        const columns = [
          { header: "Code", key: "code", width: 14 },
          { header: "Prénom", key: "firstName", width: 16 },
          { header: "Nom", key: "lastName", width: 18 },
          { header: "Catégorie", key: "category", width: 18 },
          { header: "Téléphone", key: "phone", width: 18 },
          { header: "E-mail", key: "email", width: 28 },
          { header: "Date d'embauche", key: "hireDate", width: 14 },
          { header: "Statut", key: "status", width: 14 },
          {
            header: "Heures hebdo. cibles",
            key: "weeklyHoursTarget",
            width: 14,
          },
          {
            header: "Heures hebdo. effectuées",
            key: "weeklyHoursLogged",
            width: 14,
          },
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
          salary:
            p.salary != null
              ? new Intl.NumberFormat("fr-FR").format(p.salary)
              : "—",
        }));
        exportToXlsx(
          [{ name: "Personnel", columns, rows }],
          `annuaire-personnel-${new Date().toISOString().slice(0, 10)}.xlsx`,
        );
        toast.showSuccess(
          "Export XLSX",
          `${personnel.length} personnel(s) exporté(s).`,
        );
        return;
      } else if (code === "annuaire-personnel" && format === "PDF") {
        if (personnel.length === 0) {
          toast.showWarning("Aucun personnel", "Rien à exporter.");
          return;
        }
        const bytes = await generatePersonnelDirectoryPdf(personnel);
        fileName = `annuaire-personnel-${new Date().toISOString().slice(0, 10)}.pdf`;
        downloadPdf(bytes, fileName);
        exportedRows = personnel.length;
        toast.showSuccess("Rapport PDF généré", fileName);
      } else if (code === "depenses-categorie" && format === "XLSX") {
        const { exportToXlsx } =
          await import("../../../infrastructure/excel/export-engine");
        const byCategory = new Map<string, number>();
        for (const e of expenses) {
          byCategory.set(
            e.category,
            (byCategory.get(e.category) ?? 0) + e.amount,
          );
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
        toast.showSuccess(
          "Export XLSX",
          `${byCategory.size} catégories exportées.`,
        );
        return;
      } else if (code === "depenses-categorie" && format === "PDF") {
        const bytes = await generateExpensesByCategoryPdf(expenses);
        fileName = `depenses-categorie-${new Date().toISOString().slice(0, 10)}.pdf`;
        downloadPdf(bytes, fileName);
        exportedRows = expenses.length;
        toast.showSuccess("Rapport PDF généré", fileName);
      }

      if (code !== "export-complet") {
        toast.showSuccess("Export téléchargé", `Fichier généré avec succès.`);
      }

      if (exportedRows !== null) {
        void repos.audit.log({
          action: AuditActions.SystemExport,
          entityType: "report",
          entityId: code,
          actorId: session?.userId ?? "system",
          actorName: session?.displayName ?? "Session courante",
          tenantId: session?.tenantId ?? "mock",
          diff: {
            before: null,
            after: { report: code, format, rows: exportedRows },
          },
          note: `Export ${format} — rapport « ${code} » (${exportedRows} lignes)`,
        });
      }
    } catch (e) {
      toast.showError(
        "Échec de l'export",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4 pb-8" data-testid="reports-tab">
      {/* 1. Master Export Banner */}
      <Card className="rounded-xl border border-primary/40 bg-gradient-to-r from-primary/15 via-primary/5 to-surface-panel p-0 overflow-hidden shadow-sm">
        <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/20 text-primary flex items-center justify-center shrink-0 border border-primary/30 shadow-inner">
              <Database className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">
                  Export Intégral de l'Établissement (Master Workbook)
                </h3>
                <Badge variant="success" className="text-[10px] font-mono px-2">
                  13 Feuilles
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                Génération en un clic du classeur Excel complet consolidant :
                Parents, Élèves, Personnel, Paiements, Tranches, Grand Livre,
                Dépenses, Notes, Présences, Créances, Classes et Table
                tarifaire.
              </p>
            </div>
          </div>

          <Button
            size="default"
            className="gap-2 font-bold shadow-sm whitespace-nowrap self-start md:self-center"
            disabled={exporting === "export-complet-XLSX"}
            onClick={() => handleExport("export-complet", "XLSX")}
          >
            {exporting === "export-complet-XLSX" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Télécharger le Classeur (.xlsx)
          </Button>
        </CardContent>
      </Card>

      {/* 2. Standard Analytical Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {standardReports.map((r) => {
          const Icon = r.icon;
          return (
            <Card
              key={r.code}
              className="rounded-xl border border-border/70 bg-surface-panel hover:border-primary/40 hover:bg-surface-elevated/30 transition-all shadow-sm"
            >
              <CardContent className="p-4 flex flex-col justify-between h-full space-y-4">
                <div className="flex items-start gap-3">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border border-border/40"
                    style={{
                      backgroundColor: `${r.color}15`,
                      color: r.color,
                    }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <h4 className="text-sm font-bold text-foreground truncate">
                      {r.title}
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {r.desc}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/40">
                  <span className="text-[11px] font-mono text-muted-foreground uppercase">
                    Formats disponibles
                  </span>

                  <div className="flex items-center gap-1.5">
                    {r.formats.map((fmt) => {
                      if (fmt === "Voir Settings") {
                        return (
                          <Button
                            key={fmt}
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-primary gap-1"
                            onClick={() =>
                              window.location.assign("/#/settings?tab=audit")
                            }
                          >
                            Ouvrir l'audit
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        );
                      }

                      const isBusy = exporting === `${r.code}-${fmt}`;

                      return (
                        <Button
                          key={fmt}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2.5 gap-1 border-border/70"
                          disabled={isBusy}
                          onClick={() => handleExport(r.code, fmt)}
                        >
                          {isBusy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          {fmt}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
