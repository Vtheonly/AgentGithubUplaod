/**
 * StatStrip — the Power BI "card" row: descriptive statistics over the
 * FILTERED paid-payments slice (T-255, 38th session — UI-307).
 *
 * Every figure comes from `derivePaymentStats` (pure derivation of the
 * canonical payments stream, §15.16 — no synthesized statistics). The
 * cards cross-filter with the tab's slicers because the slice they
 * summarize is the slicer output.
 */
import { Wallet, Receipt, Scale, ArrowUpDown, Trophy, Activity } from "lucide-react";
import { formatDzd } from "../../../../core/format/currency";
import { derivePaymentStats, type PaymentStats } from "./analytics-derivations";
import type { Payment } from "../../../../domain/model/payment";

export interface StatStripProps {
  slice: readonly Payment[];
}

/** One stat card — label, value, icon, contextual sub-line. */
function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "primary" | "success" | "info" | "warning" | "violet" | "neutral";
}) {
  const toneClass = {
    primary: "text-primary",
    success: "text-status-success",
    info: "text-status-info",
    warning: "text-status-warning",
    violet: "text-brand-violet",
    neutral: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-surface-panel px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
        <span className={`${toneClass} shrink-0`}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-mono text-sm font-semibold text-foreground tabular-nums truncate" title={value}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function statsToCards(s: PaymentStats): React.ReactNode[] {
  return [
    <StatCard
      key="total"
      icon={<Wallet className="h-3.5 w-3.5" />}
      label="Encaissé (filtré)"
      value={formatDzd(s.total, { compact: true })}
      sub={`${s.count} opération${s.count > 1 ? "s" : ""}`}
      tone="primary"
    />,
    <StatCard
      key="count"
      icon={<Receipt className="h-3.5 w-3.5" />}
      label="Opérations"
      value={String(s.count)}
      sub="paiements encaissés"
      tone="info"
    />,
    <StatCard
      key="mean"
      icon={<Scale className="h-3.5 w-3.5" />}
      label="Panier moyen"
      value={s.count > 0 ? formatDzd(s.mean, { compact: true }) : "—"}
      sub="moyenne par opération"
      tone="success"
    />,
    <StatCard
      key="median"
      icon={<Activity className="h-3.5 w-3.5" />}
      label="Médiane"
      value={s.count > 0 ? formatDzd(s.median, { compact: true }) : "—"}
      sub="valeur centrale"
      tone="violet"
    />,
    <StatCard
      key="best"
      icon={<Trophy className="h-3.5 w-3.5" />}
      label="Meilleur mois"
      value={s.bestMonth ? s.bestMonth.label : "—"}
      sub={s.bestMonth ? formatDzd(s.bestMonth.amount, { compact: true }) : undefined}
      tone="warning"
    />,
    <StatCard
      key="volatility"
      icon={<ArrowUpDown className="h-3.5 w-3.5" />}
      label="Volatilité (σ)"
      value={s.count > 1 ? formatDzd(s.stdDev, { compact: true }) : "—"}
      sub="écart-type des montants"
      tone="neutral"
    />,
  ];
}

export function StatStrip({ slice }: StatStripProps) {
  const stats = derivePaymentStats(slice);
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5"
      data-testid="analytics-stat-strip"
      data-count={stats.count}
      data-total={stats.total}
    >
      {statsToCards(stats)}
    </div>
  );
}
