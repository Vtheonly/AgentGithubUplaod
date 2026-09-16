// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/stat-strip.tsx
// ============================================================================

import {
  Wallet,
  Receipt,
  Scale,
  ArrowUpDown,
  Trophy,
  Activity,
} from "lucide-react";
import { formatDzd } from "../../../../core/format/currency";
import { derivePaymentStats, type PaymentStats } from "./analytics-derivations";
import type { Payment } from "../../../../domain/model/payment";

export interface StatStripProps {
  slice: readonly Payment[];
}

function StatTile({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface-panel p-3 flex flex-col justify-between space-y-1 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
        <div
          className="h-6 w-6 rounded-md flex items-center justify-center shrink-0"
          style={{
            backgroundColor: `${color}15`,
            color: color,
          }}
        >
          {icon}
        </div>
      </div>
      <div
        className="font-mono text-base font-bold text-foreground tabular-nums truncate"
        title={value}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
      )}
    </div>
  );
}

export function StatStrip({ slice }: StatStripProps) {
  const stats = derivePaymentStats(slice);

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"
      data-testid="analytics-stat-strip"
      data-count={stats.count}
      data-total={stats.total}
    >
      <StatTile
        icon={<Wallet className="h-3.5 w-3.5" />}
        label="Total Encaissé"
        value={formatDzd(stats.total, { compact: true })}
        sub={`${stats.count} versements`}
        color="var(--brand-blue, #349bd4)"
      />
      <StatTile
        icon={<Receipt className="h-3.5 w-3.5" />}
        label="Volume Transactions"
        value={String(stats.count)}
        sub="reçus émis"
        color="var(--brand-cyan, #3dd6d0)"
      />
      <StatTile
        icon={<Scale className="h-3.5 w-3.5" />}
        label="Panier Moyen"
        value={stats.count > 0 ? formatDzd(stats.mean, { compact: true }) : "—"}
        sub="moyenne / opération"
        color="var(--status-success, #10b981)"
      />
      <StatTile
        icon={<Activity className="h-3.5 w-3.5" />}
        label="Médiane"
        value={
          stats.count > 0 ? formatDzd(stats.median, { compact: true }) : "—"
        }
        sub="valeur médiane"
        color="var(--brand-violet, #8b5cf6)"
      />
      <StatTile
        icon={<Trophy className="h-3.5 w-3.5" />}
        label="Mois Record"
        value={stats.bestMonth ? stats.bestMonth.label : "—"}
        sub={
          stats.bestMonth
            ? formatDzd(stats.bestMonth.amount, { compact: true })
            : undefined
        }
        color="var(--brand-gold, #eab308)"
      />
      <StatTile
        icon={<ArrowUpDown className="h-3.5 w-3.5" />}
        label="Volatilité (σ)"
        value={
          stats.count > 1 ? formatDzd(stats.stdDev, { compact: true }) : "—"
        }
        sub="dispersion montants"
        color="var(--muted-foreground, #94a3b8)"
      />
    </div>
  );
}
