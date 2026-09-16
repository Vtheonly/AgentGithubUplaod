// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/pivot-matrix-card.tsx
// ============================================================================

import { useState, useMemo } from "react";
import { Layers, ArrowUpDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { AcademicClass } from "../../../../domain/model/academic";
import {
  computeMultiDimensionalPivot,
  type StudentRiskProfile,
  type PivotDimension,
} from "./operational-query-engine";

interface Props {
  profiles: StudentRiskProfile[];
  classes: readonly AcademicClass[];
}

export function PivotMatrixCard({ profiles, classes }: Props) {
  const [dimension, setDimension] = useState<PivotDimension>("cycle");
  const [sortKey, setSortKey] = useState<
    "studentCount" | "totalDebt" | "averageGpa"
  >("totalDebt");
  const [sortAsc, setSortAsc] = useState(false);

  const pivotRows = useMemo(() => {
    const raw = computeMultiDimensionalPivot({
      profiles,
      classes,
      dimension,
    });
    return raw.sort((a, b) => {
      const valA = a[sortKey] ?? -1;
      const valB = b[sortKey] ?? -1;
      if (valA === valB) return 0;
      return sortAsc ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
    });
  }, [profiles, classes, dimension, sortKey, sortAsc]);

  const grandTotals = useMemo(() => {
    const totalStudents = pivotRows.reduce((s, r) => s + r.studentCount, 0);
    const totalDebt = pivotRows.reduce((s, r) => s + r.totalDebt, 0);
    const criticalTotal = pivotRows.reduce(
      (s, r) => s + r.criticalStudentsCount,
      0,
    );
    return { totalStudents, totalDebt, criticalTotal };
  }, [pivotRows]);

  return (
    <Card className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between">
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Matrice Croisée Multi-Dimensionnelle
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Performances académiques, assiduité et créances par segment
          </CardDescription>
        </div>

        <div className="flex rounded-md border border-border bg-surface-elevated/40 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setDimension("cycle")}
            className={`px-2.5 py-1 rounded transition-colors ${
              dimension === "cycle"
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Cycles
          </button>
          <button
            type="button"
            onClick={() => setDimension("grade")}
            className={`px-2.5 py-1 rounded transition-colors ${
              dimension === "grade"
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Paliers
          </button>
          <button
            type="button"
            onClick={() => setDimension("class")}
            className={`px-2.5 py-1 rounded transition-colors ${
              dimension === "class"
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Classes
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground text-left">
            <tr className="border-b border-border/60">
              <th className="py-2.5 px-3 font-medium">Segment</th>
              <th
                className="py-2.5 px-3 text-right font-medium cursor-pointer"
                onClick={() => {
                  setSortKey("studentCount");
                  setSortAsc(!sortAsc);
                }}
              >
                Effectif <ArrowUpDown className="h-2.5 w-2.5 inline ml-0.5" />
              </th>
              <th
                className="py-2.5 px-3 text-right font-medium cursor-pointer"
                onClick={() => {
                  setSortKey("totalDebt");
                  setSortAsc(!sortAsc);
                }}
              >
                Créances <ArrowUpDown className="h-2.5 w-2.5 inline ml-0.5" />
              </th>
              <th
                className="py-2.5 px-3 text-center font-medium cursor-pointer"
                onClick={() => {
                  setSortKey("averageGpa");
                  setSortAsc(!sortAsc);
                }}
              >
                Moyenne <ArrowUpDown className="h-2.5 w-2.5 inline ml-0.5" />
              </th>
              <th className="py-2.5 px-3 text-center font-medium">Assiduité</th>
              <th className="py-2.5 px-3 text-right font-medium">Alertes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {pivotRows.map((r) => (
              <tr key={r.dimensionKey} className="hover:bg-accent/5">
                <td className="py-2.5 px-3 font-medium text-foreground">
                  {r.dimensionLabel}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold">
                  {r.studentCount}
                </td>
                <td className="py-2.5 px-3 text-right font-mono">
                  {r.totalDebt > 0 ? (
                    <span className="text-status-danger font-bold">
                      {formatDzdPlain(r.totalDebt)} DA
                    </span>
                  ) : (
                    <span className="text-status-success font-medium">
                      0 DA
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-center font-mono">
                  {r.averageGpa !== null ? (
                    <span
                      className={`font-semibold ${
                        r.averageGpa >= 10
                          ? "text-status-success"
                          : "text-status-danger"
                      }`}
                    >
                      {r.averageGpa.toFixed(2)}/20
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-center font-mono">
                  {(r.attendanceRate * 100).toFixed(0)}%
                </td>
                <td className="py-2.5 px-3 text-right font-mono">
                  {r.criticalStudentsCount > 0 ? (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-status-danger/15 text-status-danger font-bold">
                      {r.criticalStudentsCount}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="font-bold border-t-2 border-border/80 bg-surface-elevated/30">
              <td className="py-2.5 px-3">Total Général</td>
              <td className="py-2.5 px-3 text-right font-mono">
                {grandTotals.totalStudents}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-status-danger">
                {formatDzd(grandTotals.totalDebt, { compact: true })}
              </td>
              <td className="py-2.5 px-3 text-center font-mono">—</td>
              <td className="py-2.5 px-3 text-center font-mono">—</td>
              <td className="py-2.5 px-3 text-right font-mono text-status-danger">
                {grandTotals.criticalTotal}
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
