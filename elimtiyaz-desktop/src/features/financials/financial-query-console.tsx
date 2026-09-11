// ============================================================================
// FILE: src/features/financials/financial-query-console.tsx
// ============================================================================
/**
 * Financial Query & Investigation Console.
 *
 * An interactive console right inside the Financials page allowing staff to:
 *   - Search by parent, phone, student, or amount.
 *   - Click pre-configured strategic queries (Leakage, Float, Credits, Defaults).
 *   - View anomaly diagnostic notes.
 *   - 1-click actions: Encaisser (with exact preset), WhatsApp parent, or
 *     launch an instant AI audit in Copilot!
 */

import { useState, useMemo } from "react";
import {
  Search,
  Wallet,
  MessageCircle,
  ExternalLink,
  Bot,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Phone,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { useAICopilot } from "../../app/providers/ai-copilot-provider";
import {
  FINANCIAL_PRESETS,
  type FamilyFinancialDiagnosis,
} from "../../domain/calc/payment/financial-query-engine";

interface Props {
  diagnoses: FamilyFinancialDiagnosis[];
  onOpenParent: (parentId: string) => void;
  onCollectPayment: (parentId: string, amount: number) => void;
}

export function FinancialQueryConsole({
  diagnoses,
  onOpenParent,
  onCollectPayment,
}: Props) {
  const { askAgent, setIsOpen: openCopilot } = useAICopilot();

  const [search, setSearch] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(
    "service_leakage",
  );
  const [sortField, setSortField] = useState<
    "totalDebt" | "daysOverdue" | "unallocatedCredit"
  >("totalDebt");
  const [sortAsc, setSortAsc] = useState(false);

  // Filter pipeline
  const filteredDiagnoses = useMemo(() => {
    return diagnoses
      .filter((f) => {
        // Preset filter
        if (activePreset) {
          const preset = FINANCIAL_PRESETS.find((p) => p.id === activePreset);
          if (preset && !preset.filter(f)) return false;
        }

        // Search text
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            f.parentName.toLowerCase().includes(q) ||
            f.parentPhone.toLowerCase().includes(q) ||
            f.anomalySummary.toLowerCase().includes(q)
          );
        }

        return true;
      })
      .sort((a, b) => {
        const valA = a[sortField] ?? 0;
        const valB = b[sortField] ?? 0;
        if (valA === valB) return 0;
        return sortAsc ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
      });
  }, [diagnoses, activePreset, search, sortField, sortAsc]);

  // Aggregate stats of current query
  const queryTotals = useMemo(() => {
    const count = filteredDiagnoses.length;
    const totalDebt = filteredDiagnoses.reduce((s, f) => s + f.totalDebt, 0);
    const totalCredit = filteredDiagnoses.reduce(
      (s, f) => s + f.unallocatedCredit,
      0,
    );
    const totalFloat = filteredDiagnoses.reduce(
      (s, f) => s + f.pendingChecksAmount,
      0,
    );
    return { count, totalDebt, totalCredit, totalFloat };
  }, [filteredDiagnoses]);

  const handleAskAIAudit = () => {
    if (filteredDiagnoses.length === 0) return;
    const sample = filteredDiagnoses
      .slice(0, 5)
      .map(
        (f) =>
          `- ${f.parentName} (Tél: ${f.parentPhone}) : Dette ${f.totalDebt} DA (${f.daysOverdue}j retard) | ${f.anomalySummary}`,
      )
      .join("\n");

    const prompt =
      `Je consulte la sélection financière « ${activePreset} » (${filteredDiagnoses.length} familles identifiées, dette totale : ${queryTotals.totalDebt.toLocaleString("fr-FR")} DA).\n` +
      `Voici un échantillon de dossiers :\n${sample}\n\n` +
      `Analyse la nature de ces anomalies financières et propose un plan d'action d'apurement et de relance ciblé pour le service comptabilité.`;

    openCopilot(true);
    void askAgent(prompt);
  };

  const handleAskAIParent = (f: FamilyFinancialDiagnosis) => {
    const prompt =
      `Audit financier pour la famille de ${f.parentName} (${f.studentCount} enfant(s), Tél: ${f.parentPhone}) :\n` +
      `- Total facturé : ${f.totalDue.toLocaleString("fr-FR")} DA\n` +
      `- Total réglé : ${f.totalPaid.toLocaleString("fr-FR")} DA\n` +
      `- Solde débiteur actuel : ${f.totalDebt.toLocaleString("fr-FR")} DA (${f.daysOverdue} jours de retard)\n` +
      `- Crédit parent disponible non absorbé : ${f.unallocatedCredit.toLocaleString("fr-FR")} DA\n` +
      `- Chèques en cours non compensés : ${f.pendingChecksAmount.toLocaleString("fr-FR")} DA\n` +
      `- Diagnostic détecté : ${f.anomalySummary}\n\n` +
      `Propose la meilleure stratégie de régularisation pour cette famille (compensation de crédit, proposition de plan de paiement, ou rappel officiel).`;

    openCopilot(true);
    void askAgent(prompt);
  };

  return (
    <Card className="border-border bg-surface-panel shadow-sm">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              Console d'Investigation & Diagnostic Financier
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Interrogez les créances, anomalies de paiement et opportunités de
              compensation
            </CardDescription>
          </div>

          {filteredDiagnoses.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAskAIAudit}
              className="h-8 gap-1.5 border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary text-xs"
            >
              <Bot className="h-3.5 w-3.5" />
              Audit IA sur la sélection ({filteredDiagnoses.length})
            </Button>
          )}
        </div>

        {/* Preset Queries Bar */}
        <div className="flex items-center gap-1.5 flex-wrap pt-2">
          {FINANCIAL_PRESETS.map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setActivePreset(isActive ? null : preset.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-surface-elevated/40 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {preset.title}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Search & Sort Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par parent, téléphone ou mot-clé..."
              className="h-8 pl-8 text-xs bg-surface-elevated/40"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Trier par :</span>
            <Button
              variant={sortField === "totalDebt" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (sortField === "totalDebt") setSortAsc(!sortAsc);
                else {
                  setSortField("totalDebt");
                  setSortAsc(false);
                }
              }}
            >
              Dette
              <ArrowUpDown className="h-3 w-3 ml-0.5" />
            </Button>
            <Button
              variant={sortField === "daysOverdue" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (sortField === "daysOverdue") setSortAsc(!sortAsc);
                else {
                  setSortField("daysOverdue");
                  setSortAsc(false);
                }
              }}
            >
              Retard (j)
              <ArrowUpDown className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </div>

        {/* Live Aggregates Header */}
        <div className="flex flex-wrap items-center justify-between text-xs px-3 py-2 rounded-md bg-muted/20 border border-border/50 text-muted-foreground gap-2">
          <span>
            Familles identifiées :{" "}
            <strong className="text-foreground">{queryTotals.count}</strong>
          </span>
          <div className="flex items-center gap-4">
            {queryTotals.totalDebt > 0 && (
              <span>
                Créances :{" "}
                <strong className="text-status-danger font-mono">
                  {formatDzdPlain(queryTotals.totalDebt)} DA
                </strong>
              </span>
            )}
            {queryTotals.totalCredit > 0 && (
              <span>
                Crédit disponible :{" "}
                <strong className="text-status-success font-mono">
                  {formatDzdPlain(queryTotals.totalCredit)} DA
                </strong>
              </span>
            )}
            {queryTotals.totalFloat > 0 && (
              <span>
                Float chèques :{" "}
                <strong className="text-status-warning font-mono">
                  {formatDzdPlain(queryTotals.totalFloat)} DA
                </strong>
              </span>
            )}
          </div>
        </div>

        {/* Results Table */}
        <div className="rounded-md border border-border overflow-hidden">
          {filteredDiagnoses.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-xs">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-status-success/60" />
              Aucun dossier ne correspond à ce diagnostic spécifique. La
              situation est saine !
            </div>
          ) : (
            <div className="max-h-[380px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground sticky top-0 bg-surface-panel z-10">
                  <tr className="border-b border-border/60">
                    <th className="text-left font-medium py-2 px-3">
                      Parent & Contact
                    </th>
                    <th className="text-right font-medium py-2 px-3">
                      Solde Dû
                    </th>
                    <th className="text-right font-medium py-2 px-3">
                      Crédit Dispo
                    </th>
                    <th className="text-left font-medium py-2 px-3">
                      Diagnostic & Recommandation
                    </th>
                    <th className="text-right font-medium py-2 px-3">
                      Actions Directes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredDiagnoses.map((f) => (
                    <tr
                      key={f.parentId}
                      className="hover:bg-accent/5 transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-foreground">
                          {f.parentName}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {f.parentPhone} · {f.studentCount} enfant(s)
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono">
                        {f.totalDebt > 0 ? (
                          <div>
                            <span className="font-bold text-status-danger">
                              {formatDzdPlain(f.totalDebt)}
                            </span>
                            <div className="text-[10px] text-muted-foreground">
                              {f.daysOverdue} j retard
                            </div>
                          </div>
                        ) : (
                          <span className="text-status-success font-medium">
                            0 DA
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono">
                        {f.unallocatedCredit > 0 ? (
                          <span className="font-semibold text-status-success bg-status-success/10 px-1.5 py-0.5 rounded">
                            {formatDzdPlain(f.unallocatedCredit)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 max-w-[260px]">
                        <p className="text-foreground text-[11px] font-medium leading-tight">
                          {f.anomalySummary}
                        </p>
                        <p className="text-[10px] text-primary italic mt-0.5">
                          → {f.recommendedAction}
                        </p>
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-primary hover:bg-primary/10"
                            onClick={() => handleAskAIParent(f)}
                            title="Analyser avec l'IA"
                          >
                            <Bot className="h-3.5 w-3.5" />
                          </Button>

                          {f.parentPhone && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-status-success hover:bg-status-success/10"
                              onClick={() => {
                                const clean = f.parentPhone.replace(
                                  /[\s+]/g,
                                  "",
                                );
                                window.open(`https://wa.me/${clean}`);
                              }}
                              title="Envoyer WhatsApp"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {f.totalDebt > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-status-danger hover:bg-status-danger/10 font-mono"
                              onClick={() =>
                                onCollectPayment(f.parentId, f.totalDebt)
                              }
                              title="Encaisser"
                            >
                              <Wallet className="h-3 w-3 mr-1" /> Encaisser
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => onOpenParent(f.parentId)}
                            title="Ouvrir dossier financier"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
