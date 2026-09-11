// ============================================================================
// FILE: src/features/dashboard/components/class-capacity-analyzer.tsx
// ============================================================================
/**
 * Class Capacity & Enrollment Analyzer.
 *
 * Replaces the broken/inverted SVG arc speedometers with:
 *   1. Mathematically sound semi-circular gauges using SVG pathLength="100".
 *   2. Health triage filter pills: Surchargées (≥100%), Optimales (60-95%), Sous-effectif (<60%).
 *   3. Real capacity numbers (Inscrits / Capacité max + places restantes).
 *   4. Dual view toggle: "Jauges Modernes" vs "Tableau Détaillé".
 *   5. Search and sorting by fill rate, student count, or name.
 */

import { useState, useMemo } from "react";
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  ArrowUpDown,
  LayoutGrid,
  List,
  Search,
  School,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { Input } from "../../../shared/ui/input";
import type { DemographicSlice } from "../../../domain/model/operations";

export type CapacityTier = "all" | "overcrowded" | "optimal" | "under_enrolled";

interface EnrichedClassCapacity {
  label: string;
  enrolled: number;
  percent: number;
  maxSeats: number;
  vacancies: number;
  excess: number;
  tier: "overcrowded" | "optimal" | "under_enrolled";
}

export function ClassCapacityAnalyzer({
  capacityData,
}: {
  capacityData: readonly DemographicSlice[];
}) {
  const [tierFilter, setTierFilter] = useState<CapacityTier>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"gauges" | "table">("gauges");
  const [sortBy, setSortBy] = useState<
    "percent_desc" | "percent_asc" | "enrolled_desc" | "name"
  >("percent_desc");

  // Enrich raw slices with realistic max capacity, vacancies, and triage tiers
  const enrichedList = useMemo<EnrichedClassCapacity[]>(() => {
    return capacityData.map((c) => {
      // Derive max seats: if percent > 0, max = Math.round(count / (percent / 100)), fallback to 30
      const maxSeats =
        c.percent > 0
          ? Math.max(1, Math.round(c.count / (c.percent / 100)))
          : 30;
      const vacancies = Math.max(0, maxSeats - c.count);
      const excess = Math.max(0, c.count - maxSeats);

      let tier: "overcrowded" | "optimal" | "under_enrolled" = "optimal";
      if (c.percent >= 100) {
        tier = "overcrowded";
      } else if (c.percent < 60) {
        tier = "under_enrolled";
      }

      return {
        label: c.label,
        enrolled: c.count,
        percent: c.percent,
        maxSeats,
        vacancies,
        excess,
        tier,
      };
    });
  }, [capacityData]);

  // Overall school capacity totals
  const summary = useMemo(() => {
    const totalEnrolled = enrichedList.reduce((s, c) => s + c.enrolled, 0);
    const totalCapacity = enrichedList.reduce((s, c) => s + c.maxSeats, 0);
    const overallRate =
      totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0;
    const overcrowdedCount = enrichedList.filter(
      (c) => c.tier === "overcrowded",
    ).length;
    const optimalCount = enrichedList.filter(
      (c) => c.tier === "optimal",
    ).length;
    const underEnrolledCount = enrichedList.filter(
      (c) => c.tier === "under_enrolled",
    ).length;

    return {
      totalEnrolled,
      totalCapacity,
      overallRate,
      overcrowdedCount,
      optimalCount,
      underEnrolledCount,
    };
  }, [enrichedList]);

  // Filtered and sorted classes
  const filtered = useMemo(() => {
    return enrichedList
      .filter((c) => {
        if (tierFilter !== "all" && c.tier !== tierFilter) return false;
        if (search.trim()) {
          return c.label.toLowerCase().includes(search.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "percent_desc") return b.percent - a.percent;
        if (sortBy === "percent_asc") return a.percent - b.percent;
        if (sortBy === "enrolled_desc") return b.enrolled - a.enrolled;
        if (sortBy === "name") return a.label.localeCompare(b.label, "fr");
        return 0;
      });
  }, [enrichedList, tierFilter, search, sortBy]);

  return (
    <Card className="border-border bg-surface-panel overflow-hidden">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <School className="h-4 w-4 text-primary" />
              Capacité &amp; Remplissage des Classes
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Analyse opérationnelle des effectifs par classe ·{" "}
              {summary.totalEnrolled} élèves sur {summary.totalCapacity} places
              ({summary.overallRate}% global)
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex rounded-md border border-border bg-surface-elevated/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("gauges")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                  viewMode === "gauges"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="h-3 w-3" /> Jauges
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                  viewMode === "table"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="h-3 w-3" /> Tableau
              </button>
            </div>
          </div>
        </div>

        {/* Triage summary badges */}
        <div className="grid grid-cols-3 gap-2 pt-2">
          <button
            type="button"
            onClick={() =>
              setTierFilter(
                tierFilter === "overcrowded" ? "all" : "overcrowded",
              )
            }
            className={`p-2 rounded-lg border text-left transition-all ${
              tierFilter === "overcrowded"
                ? "border-status-danger bg-status-danger/15 ring-1 ring-status-danger"
                : "border-status-danger/30 bg-status-danger/5 hover:bg-status-danger/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-status-danger">
                Surcharge (≥100%)
              </span>
              <AlertTriangle className="h-3.5 w-3.5 text-status-danger" />
            </div>
            <div className="text-lg font-mono font-bold text-status-danger mt-0.5">
              {summary.overcrowdedCount}{" "}
              <span className="text-[10px] font-normal text-muted-foreground">
                classes
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setTierFilter(tierFilter === "optimal" ? "all" : "optimal")
            }
            className={`p-2 rounded-lg border text-left transition-all ${
              tierFilter === "optimal"
                ? "border-status-success bg-status-success/15 ring-1 ring-status-success"
                : "border-status-success/30 bg-status-success/5 hover:bg-status-success/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-status-success">
                Optimales (60–95%)
              </span>
              <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />
            </div>
            <div className="text-lg font-mono font-bold text-status-success mt-0.5">
              {summary.optimalCount}{" "}
              <span className="text-[10px] font-normal text-muted-foreground">
                classes
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setTierFilter(
                tierFilter === "under_enrolled" ? "all" : "under_enrolled",
              )
            }
            className={`p-2 rounded-lg border text-left transition-all ${
              tierFilter === "under_enrolled"
                ? "border-status-info bg-status-info/15 ring-1 ring-status-info"
                : "border-status-info/30 bg-status-info/5 hover:bg-status-info/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-status-info">
                Sous-effectif (&lt;60%)
              </span>
              <TrendingDown className="h-3.5 w-3.5 text-status-info" />
            </div>
            <div className="text-lg font-mono font-bold text-status-info mt-0.5">
              {summary.underEnrolledCount}{" "}
              <span className="text-[10px] font-normal text-muted-foreground">
                classes
              </span>
            </div>
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Search & Sort Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer par nom de classe..."
              className="h-8 pl-8 text-xs bg-surface-elevated/40"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <ArrowUpDown className="h-3 w-3" /> Trier :
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="h-8 rounded-md border border-border bg-surface-elevated/50 px-2 text-xs text-foreground focus:outline-none"
            >
              <option value="percent_desc">Remplissage (Élevé → Faible)</option>
              <option value="percent_asc">Remplissage (Faible → Élevé)</option>
              <option value="enrolled_desc">Effectif (Plus peuplé)</option>
              <option value="name">Nom alphabétique</option>
            </select>
          </div>
        </div>

        {/* VIEW 1: Redesigned Visual Gauges */}
        {viewMode === "gauges" ? (
          filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-12">
              Aucune classe ne correspond aux filtres sélectionnés.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filtered.map((item) => (
                <CapacityGaugeCard key={item.label} item={item} />
              ))}
            </div>
          )
        ) : (
          /* VIEW 2: Clean Tabular Matrix */
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr className="border-b border-border/60 text-left">
                  <th className="py-2 px-3 font-medium">Classe</th>
                  <th className="py-2 px-3 text-center font-medium">
                    Inscrits / Capacité
                  </th>
                  <th className="py-2 px-3 text-center font-medium">
                    Places restantes
                  </th>
                  <th className="py-2 px-4 font-medium w-48">
                    Taux de remplissage
                  </th>
                  <th className="py-2 px-3 text-right font-medium">
                    Diagnostic
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((item) => {
                  const toneColor =
                    item.percent >= 100
                      ? "#ef4444"
                      : item.percent >= 80
                        ? "#f59e0b"
                        : item.percent >= 60
                          ? "#10b981"
                          : "#0ea5e9";

                  return (
                    <tr
                      key={item.label}
                      className="hover:bg-accent/5 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-medium text-foreground">
                        {item.label}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">
                        <strong>{item.enrolled}</strong> / {item.maxSeats}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">
                        {item.excess > 0 ? (
                          <span className="text-status-danger font-semibold">
                            +{item.excess} en surnombre
                          </span>
                        ) : item.vacancies === 0 ? (
                          <span className="text-muted-foreground">
                            0 (complet)
                          </span>
                        ) : (
                          <span className="text-status-success font-semibold">
                            {item.vacancies} dispo
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, item.percent)}%`,
                                backgroundColor: toneColor,
                              }}
                            />
                          </div>
                          <span
                            className="font-mono font-bold text-[11px] w-10 text-right"
                            style={{ color: toneColor }}
                          >
                            {item.percent}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {item.percent >= 100 ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-status-danger/10 text-status-danger border-status-danger/30"
                          >
                            {item.percent > 100 ? "Surcharge" : "Plein"}
                          </Badge>
                        ) : item.percent >= 80 ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-status-warning/10 text-status-warning border-status-warning/30"
                          >
                            Quasi plein
                          </Badge>
                        ) : item.percent >= 60 ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-status-success/10 text-status-success border-status-success/30"
                          >
                            Optimal
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-status-info/10 text-status-info border-status-info/30"
                          >
                            Sous-effectif
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Clean, mathematically exact SVG Semi-Circle Gauge.
 * Uses normalized pathLength="100" to prevent any arc distortion,
 * coordinate inversion, or glitchy rounded ends.
 */
function CapacityGaugeCard({ item }: { item: EnrichedClassCapacity }) {
  const clampedPercent = Math.min(100, Math.max(0, item.percent));

  // Visual tone colors
  const strokeColor =
    item.percent >= 100
      ? "#ef4444"
      : item.percent >= 80
        ? "#f59e0b"
        : item.percent >= 60
          ? "#10b981"
          : "#0ea5e9";

  return (
    <div className="rounded-lg border border-border/70 bg-surface-elevated/30 p-2.5 flex flex-col items-center justify-between text-center hover:border-primary/40 transition-all">
      {/* Upper Gauge Graphic */}
      <div className="relative w-full max-w-[100px] my-1">
        <svg viewBox="0 0 100 60" className="w-full overflow-visible">
          {/* Background Track: Upper semi-circle from (14, 50) to (86, 50), radius 36 */}
          <path
            d="M 14 50 A 36 36 0 0 1 86 50"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            className="text-muted/30"
          />

          {/* Active Fill Arc with SVG pathLength="100" (immune to coordinate bugs) */}
          <path
            d="M 14 50 A 36 36 0 0 1 86 50"
            fill="none"
            stroke={strokeColor}
            strokeWidth="7"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - clampedPercent}
            className="transition-all duration-700 ease-out"
          />

          {/* Centered Percentage readout */}
          <text
            x="50"
            y="48"
            textAnchor="middle"
            className="font-mono font-bold fill-foreground"
            fontSize="15"
          >
            {item.percent}%
          </text>
        </svg>
      </div>

      {/* Class Label & Seat Count */}
      <div className="w-full mt-1 space-y-0.5">
        <p
          className="text-xs font-semibold text-foreground truncate px-1"
          title={item.label}
        >
          {item.label}
        </p>

        <p className="text-[11px] font-mono text-muted-foreground">
          <strong>{item.enrolled}</strong> / {item.maxSeats} places
        </p>

        {/* Operational Helper Chip */}
        <div className="pt-1">
          {item.excess > 0 ? (
            <span className="text-[10px] font-semibold text-status-danger">
              +{item.excess} en surnombre
            </span>
          ) : item.vacancies === 0 ? (
            <span className="text-[10px] text-status-danger font-medium">
              Classe complète
            </span>
          ) : item.tier === "under_enrolled" ? (
            <span className="text-[10px] text-status-info font-medium">
              {item.vacancies} places libres
            </span>
          ) : (
            <span className="text-[10px] text-status-success font-medium">
              {item.vacancies} dispo
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
