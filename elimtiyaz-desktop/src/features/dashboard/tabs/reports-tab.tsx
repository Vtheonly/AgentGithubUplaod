/**
 * Reports tab — GLOBAL macro reports only (per spec §5.1)
 *
 * Entity-specific reports live in profile drawers (per spec §5.2).
 *
 * Extracted from `dashboard-page.tsx` (Task 2-a). Behavior is preserved
 * exactly — only file location and imports changed.
 *
 * T-088 (2026-08-30) — dead-feature cleanup:
 *   - Removed the misleading "PDF" format badge from the "Revenu mensuel"
 *     report card. The handler returned a "Bientôt disponible" toast
 *     when clicked — that's a fake feature pretending to be supported.
 *     Per AGENTS.md §15 rule 7 ("Never mark anything TESTED/VERIFIED
 *     without recorded evidence"), advertising an unimplemented format
 *     in the UI is the same class of dishonesty. The XLSX format remains
 *     (it's the only one actually implemented for this report).
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
import { useAuth } from "../../../app/providers/auth-provider";
import { AuditActions } from "../../../core/audit-actions";
import {
  exportRevenueReport, exportOutstandingDebtReport, exportStudentRoster,
} from "../../../infrastructure/excel/reports";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";

export function ReportsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [exporting, setExporting] = useState<string | null>(null);

  // Iteration 9: ONLY macro / organization-level aggregate reports.
  // Entity-specific reports (relevé-enseignant, releve-notes, bulletins,
  // paiements-jour) have been relocated to their respective profile drawers.
  // T-088: "PDF" format removed from "Revenu mensuel" — the handler was
  // a "Bientôt disponible" toast (a fake feature). XLSX is the only
  // actually-implemented format for this report.
  const reports = [
    {
      code: "revenu-mensuel",
      title: "Revenu mensuel",
      desc: "Excel multi-feuilles: synthèse, par méthode, par catégorie, transactions.",
      icon: TrendingUp,
      formats: ["XLSX"] as const,
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

  async function handleExport(code: string, format: "XLSX" | "PDF" | "Voir Settings") {
    if (format === "Voir Settings") {
      // Handled inline in the button renderer (opens Settings). The
      // handler should not be called for this format.
      return;
    }
    setExporting(`${code}-${format}`);
    try {
      let exportedRows: number | null = null;
      if (code === "revenu-mensuel" && format === "XLSX") {
        const payments = repos.payments.observe().get();
        const today = new Date();
        const from = new Date(today);
        from.setMonth(from.getMonth() - 12);
        await exportRevenueReport(payments, {
          from: from.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
        });
        exportedRows = payments.length;
      } else if (code === "creances-agees") {
        const summary = repos.debt.observeSummary().get();
        const parents = repos.parents.observe().get();
        const rows = summary
          .filter((d) => d.outstandingAmount > 0)
          .map((d) => ({
            // VAULT §14.04 — debt report carries the real parent phone +
            // code (previously placeholders: parentId + "").
            parentCode: parents.find((p) => p.id === d.parentId)?.code ?? d.parentId,
            parentName: d.parentName,
            parentPhone: d.parentPhone || parents.find((p) => p.id === d.parentId)?.phone || "",
            bucket: d.bucket as "0_30" | "31_60" | "61_90" | "91_180" | "180_plus",
            daysOverdue: d.daysOverdue,
            outstandingAmount: d.outstandingAmount,
          }));
        await exportOutstandingDebtReport(rows, "xlsx");
        exportedRows = rows.length;
      } else if (code === "effectifs-niveau") {
        const students = repos.students.observe().get();
        await exportStudentRoster(students);
        exportedRows = students.length;
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
        // T-088: the old "Bientôt disponible" toast for unimplemented
        // reports was dead-feature dishonesty. Each report card now
        // advertises ONLY the formats it actually implements. If a
        // new format is added, it gets a real handler; until then,
        // the badge stays out of the UI.
        toast.showError("Export non implémenté", `Le rapport "${code}" en format ${format} n'est pas encore implémenté.`);
        return;
      }
      toast.showSuccess("Export généré", `Le rapport ${code} a été téléchargé.`);
      // VAULT §12.01 — system exports (PDF / XLSX / CSV) are tracked audit
      // events, attributed to the exporting user.
      if (exportedRows !== null) {
        void repos.audit.log({
          action: AuditActions.SystemExport,
          entityType: "report",
          entityId: code,
          actorId: session?.userId ?? "system",
          actorName: session?.displayName ?? "Session courante",
          tenantId: session?.tenantId ?? "mock",
          diff: { before: null, after: { report: code, format, rows: exportedRows } },
          note: `Export ${format} — rapport « ${code} » (${exportedRows} ligne(s))`,
        });
      }
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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
