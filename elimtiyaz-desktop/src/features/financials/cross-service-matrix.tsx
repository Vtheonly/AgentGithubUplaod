// ============================================================================
// FILE: src/features/financials/cross-service-matrix.tsx
// ============================================================================
/**
 * Cross-Service Performance Matrix.
 *
 * Compares collection rates, billed amounts, and debt across every service:
 * Scolarité, Transport, Cantine, Uniformes, Thérapie, Clubs.
 */

import { Layers, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import type { ServicePerformanceRow } from "../../domain/calc/payment/financial-query-engine";

interface Props {
  services: ServicePerformanceRow[];
  onFilterService?: (category: string) => void;
}

export function CrossServiceMatrix({ services, onFilterService }: Props) {
  return (
    <Card className="border-border bg-surface-panel">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-primary" />
          Performance & Recouvrement par Prestation
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Comparatif des taux de défaut et fuites de revenus entre scolarité et
          services annexes
        </CardDescription>
      </CardHeader>

      <CardContent className="p-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 text-muted-foreground text-left">
              <th className="py-2 px-2 font-medium">Prestation</th>
              <th className="py-2 px-2 text-right font-medium">Engagé (DA)</th>
              <th className="py-2 px-2 text-right font-medium">Encaissé</th>
              <th className="py-2 px-3 text-center font-medium w-36">
                Taux de Rentrée
              </th>
              <th className="py-2 px-2 text-right font-medium">Créances</th>
              <th className="py-2 px-2 text-right font-medium">Débiteurs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {services.map((s) => {
              const tone =
                s.recoveryRate >= 90
                  ? "bg-status-success"
                  : s.recoveryRate >= 70
                    ? "bg-status-warning"
                    : "bg-status-danger";

              return (
                <tr
                  key={s.category}
                  className="hover:bg-accent/5 transition-colors cursor-pointer"
                  onClick={() => onFilterService?.(s.category)}
                  title={`Filtrer les dossiers pour ${s.label}`}
                >
                  <td className="py-2.5 px-2 font-medium text-foreground">
                    {s.label}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-muted-foreground">
                    {formatDzdPlain(s.totalBilled)}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono font-semibold text-status-success">
                    {formatDzdPlain(s.totalCleared)}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${tone}`}
                          style={{ width: `${s.recoveryRate}%` }}
                        />
                      </div>
                      <span className="font-mono font-bold text-[10px] w-8 text-right">
                        {s.recoveryRate}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono">
                    {s.outstandingDebt > 0 ? (
                      <span className="text-status-danger font-bold">
                        {formatDzdPlain(s.outstandingDebt)}
                      </span>
                    ) : (
                      <span className="text-status-success">0</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono">
                    {s.debtorFamilyCount > 0 ? (
                      <span className="text-status-danger font-semibold">
                        {s.debtorFamilyCount} / {s.totalFamiliesCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
