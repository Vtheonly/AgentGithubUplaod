// ============================================================================
// FILE: src/features/dashboard/components/analytics/operational-query-console.tsx
// ============================================================================
/**
 * Operational Query Console.
 *
 * Allows the administrator to interrogate the live school data:
 *   1. Search by student, parent, or keyword.
 *   2. Pick high-impact presets (Triple Risque, Décrochage, Créances).
 *   3. Filter by Risk Tier.
 *   4. Direct action buttons: Open Profile, WhatsApp Parent, or launch
 *      a targeted investigation with the AI Copilot.
 */

import { useState, useMemo } from "react";
import {
  Search,
  MessageCircle,
  ExternalLink,
  Bot,
  Filter,
  CheckCircle2,
  ArrowUpDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { Button } from "../../../../shared/ui/button";
import { Input } from "../../../../shared/ui/input";
import { Badge } from "../../../../shared/ui/badge";
import { formatDzdPlain } from "../../../../core/format/currency";
import { useAICopilot } from "../../../../app/providers/ai-copilot-provider";
import {
  OPERATIONAL_PRESETS,
  type StudentRiskProfile,
} from "./operational-query-engine";

interface Props {
  profiles: StudentRiskProfile[];
  onOpenStudent?: (studentId: string) => void;
  onOpenParent?: (parentId: string) => void;
}

export function OperationalQueryConsole({
  profiles,
  onOpenStudent,
}: Props) {
  const { askAgent, setIsOpen: openCopilot } = useAICopilot();

  const [search, setSearch] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(
    "triple_critical",
  );
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortField, setSortField] = useState<
    "riskScore" | "debtAmount" | "gpa"
  >("riskScore");
  const [sortAsc, setSortAsc] = useState(false);

  // Filter pipeline
  const filteredProfiles = useMemo(() => {
    return profiles
      .filter((p) => {
        // Preset filter
        if (activePreset) {
          const preset = OPERATIONAL_PRESETS.find(
            (pr) => pr.id === activePreset,
          );
          if (preset) {
            if (
              preset.filterCategory &&
              p.riskCategory !== preset.filterCategory
            )
              return false;
            if (preset.customFilter && !preset.customFilter(p)) return false;
          }
        }

        // Category filter
        if (selectedCategory !== "all" && p.riskCategory !== selectedCategory) {
          return false;
        }

        // Search text
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            p.studentName.toLowerCase().includes(q) ||
            p.studentCode.toLowerCase().includes(q) ||
            p.parentName.toLowerCase().includes(q) ||
            p.className.toLowerCase().includes(q)
          );
        }

        return true;
      })
      .sort((a, b) => {
        const valA = a[sortField] ?? -1;
        const valB = b[sortField] ?? -1;
        if (valA === valB) return 0;
        return sortAsc ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
      });
  }, [profiles, activePreset, selectedCategory, search, sortField, sortAsc]);

  // Aggregate stats of current filtered query
  const queryStats = useMemo(() => {
    const count = filteredProfiles.length;
    const totalDebt = filteredProfiles.reduce((s, p) => s + p.debtAmount, 0);
    const gpas = filteredProfiles
      .map((p) => p.gpa)
      .filter((g): g is number => g !== null);
    const avgGpa =
      gpas.length > 0 ? gpas.reduce((s, g) => s + g, 0) / gpas.length : null;
    return { count, totalDebt, avgGpa };
  }, [filteredProfiles]);

  const handleAskAIAboutCohort = () => {
    if (filteredProfiles.length === 0) return;
    const topSample = filteredProfiles
      .slice(0, 5)
      .map(
        (p) =>
          `- ${p.studentName} (${p.className}) : Moyenne ${p.gpa ?? "N/A"}/20, ${p.unexcusedAbsences} absences, Dette: ${p.debtAmount} DA`,
      )
      .join("\n");

    const prompt =
      `Je consulte la liste des élèves sous le filtre « ${activePreset ?? selectedCategory} » (${filteredProfiles.length} élèves identifiés, dette cumulée: ${queryStats.totalDebt.toLocaleString("fr-FR")} DA).\n` +
      `Voici un échantillon critique :\n${topSample}\n\n` +
      `Analyse la situation globale de cette cohorte et propose une stratégie opérationnelle en 3 points (pédagogique, suivi assiduité, et recouvrement).`;

    openCopilot(true);
    void askAgent(prompt);
  };

  const handleAskAIAboutStudent = (profile: StudentRiskProfile) => {
    const prompt =
      `Analyse approfondie pour l'élève ${profile.studentName} (${profile.className}, Parent: ${profile.parentName}).\n` +
      `- Moyenne générale : ${profile.gpa ?? "Non évalué"}/20\n` +
      `- Assiduité : ${(profile.attendanceRate * 100).toFixed(0)}% (${profile.unexcusedAbsences} absences injustifiées)\n` +
      `- Créance familiale : ${profile.debtAmount.toLocaleString("fr-FR")} DA (${profile.daysOverdue} jours de retard)\n` +
      `Donne-moi un diagnostic de situation, identifie la cause principale et propose une recommandation concrète pour l'administration.`;

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
              Console d'Interrogation & Diagnostic Opérationnel
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Posez des questions directes aux données scolaires et financières
              en temps réel
            </CardDescription>
          </div>

          {filteredProfiles.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAskAIAboutCohort}
              className="h-8 gap-1.5 border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary text-xs"
            >
              <Bot className="h-3.5 w-3.5" />
              Interroger l'IA sur cette sélection ({filteredProfiles.length})
            </Button>
          )}
        </div>

        {/* Quick Presets Bar */}
        <div className="flex items-center gap-1.5 flex-wrap pt-2">
          <span className="text-[11px] font-medium text-muted-foreground mr-1 flex items-center gap-1">
            <Filter className="h-3 w-3" /> Questions rapides :
          </span>
          {OPERATIONAL_PRESETS.map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  if (isActive) {
                    setActivePreset(null);
                  } else {
                    setActivePreset(preset.id);
                    setSelectedCategory("all");
                  }
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-surface-elevated/50 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {preset.title}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Search and Secondary Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par élève, parent, code ou classe..."
              className="h-8 pl-8 text-xs bg-surface-elevated/40"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Trier par :</span>
            <Button
              variant={sortField === "riskScore" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (sortField === "riskScore") setSortAsc(!sortAsc);
                else {
                  setSortField("riskScore");
                  setSortAsc(false);
                }
              }}
            >
              Niveau de Risque
              <ArrowUpDown className="h-3 w-3 ml-0.5" />
            </Button>
            <Button
              variant={sortField === "debtAmount" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (sortField === "debtAmount") setSortAsc(!sortAsc);
                else {
                  setSortField("debtAmount");
                  setSortAsc(false);
                }
              }}
            >
              Créance
              <ArrowUpDown className="h-3 w-3 ml-0.5" />
            </Button>
            <Button
              variant={sortField === "gpa" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (sortField === "gpa") setSortAsc(!sortAsc);
                else {
                  setSortField("gpa");
                  setSortAsc(true);
                }
              }}
            >
              Moyenne
              <ArrowUpDown className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </div>

        {/* Live Filter Summary Bar */}
        <div className="flex items-center justify-between text-xs px-3 py-2 rounded-md bg-muted/20 border border-border/50 text-muted-foreground">
          <span>
            Résultats :{" "}
            <strong className="text-foreground">{queryStats.count}</strong>{" "}
            élève(s) trouvé(s)
          </span>
          <div className="flex items-center gap-4">
            {queryStats.totalDebt > 0 && (
              <span>
                Créances cumulées :{" "}
                <strong className="text-status-danger font-mono">
                  {formatDzdPlain(queryStats.totalDebt)} DA
                </strong>
              </span>
            )}
            {queryStats.avgGpa !== null && (
              <span>
                Moyenne de cohorte :{" "}
                <strong className="text-foreground font-mono">
                  {queryStats.avgGpa.toFixed(2)} / 20
                </strong>
              </span>
            )}
          </div>
        </div>

        {/* Interactive Query Results Table */}
        <div className="rounded-md border border-border overflow-hidden">
          {filteredProfiles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-xs">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-status-success/60" />
              Aucun dossier ne correspond à ces critères d'investigation.
            </div>
          ) : (
            <div className="max-h-[380px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground sticky top-0 bg-surface-panel z-10">
                  <tr className="border-b border-border/60">
                    <th className="text-left font-medium py-2.5 px-3">
                      Élève & Classe
                    </th>
                    <th className="text-left font-medium py-2.5 px-3">
                      Parent & Contact
                    </th>
                    <th className="text-center font-medium py-2.5 px-2">
                      Moyenne
                    </th>
                    <th className="text-center font-medium py-2.5 px-2">
                      Assiduité
                    </th>
                    <th className="text-right font-medium py-2.5 px-3">
                      Créance
                    </th>
                    <th className="text-left font-medium py-2.5 px-3">
                      Facteurs de Risque
                    </th>
                    <th className="text-right font-medium py-2.5 px-3">
                      Actions Directes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredProfiles.map((p) => {
                    return (
                      <tr
                        key={p.studentId}
                        className="hover:bg-accent/5 transition-colors"
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-foreground">
                            {p.studentName}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {p.className} · {p.studentCode}
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <div
                            className="text-foreground truncate max-w-[130px]"
                            title={p.parentName}
                          >
                            {p.parentName}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {p.parentPhone}
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-center">
                          {p.gpa !== null ? (
                            <span
                              className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                                p.gpa >= 10
                                  ? "text-status-success bg-status-success/10"
                                  : "text-status-danger bg-status-danger/10"
                              }`}
                            >
                              {p.gpa.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-[10px]">
                              —
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 px-2 text-center">
                          <div className="font-mono">
                            {(p.attendanceRate * 100).toFixed(0)}%
                          </div>
                          {p.unexcusedAbsences > 0 && (
                            <div className="text-[10px] text-status-danger font-semibold">
                              {p.unexcusedAbsences} abs.
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-3 text-right font-mono">
                          {p.debtAmount > 0 ? (
                            <div>
                              <span className="font-bold text-status-danger">
                                {formatDzdPlain(p.debtAmount)}
                              </span>
                              <div className="text-[10px] text-muted-foreground">
                                {p.daysOverdue} j
                              </div>
                            </div>
                          ) : (
                            <span className="text-status-success font-medium">
                              0 DA
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 px-3 max-w-[200px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {p.riskCategory === "triple_critical" && (
                              <Badge
                                variant="outline"
                                className="text-[9px] bg-status-danger/15 text-status-danger border-status-danger/30 font-bold"
                              >
                                Triple Risque
                              </Badge>
                            )}
                            <span
                              className="text-[11px] text-muted-foreground truncate block"
                              title={p.primaryRiskReason}
                            >
                              {p.primaryRiskReason}
                            </span>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-primary hover:bg-primary/10"
                              onClick={() => handleAskAIAboutStudent(p)}
                              title="Analyser avec l'IA"
                            >
                              <Bot className="h-3.5 w-3.5" />
                            </Button>

                            {p.parentPhone && p.parentPhone !== "—" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-status-success hover:bg-status-success/10"
                                onClick={() => {
                                  const clean = p.parentPhone.replace(
                                    /[\s+]/g,
                                    "",
                                  );
                                  window.open(`https://wa.me/${clean}`);
                                }}
                                title="Contacter par WhatsApp"
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            {onOpenStudent && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => onOpenStudent(p.studentId)}
                                title="Ouvrir le dossier élève"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
