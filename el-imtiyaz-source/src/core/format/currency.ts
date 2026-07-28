/**
 * Currency formatter — DZD (Algerian Dinar).
 *
 * Format matches the Android app: `Locale.FRANCE` grouping with non-breaking
 * space, suffixed with " DZD". Example: 12500 → "12 500 DZD".
 */
const DZD_FULL = new Intl.NumberFormat("fr-FR", {
  style: "decimal",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  useGrouping: true,
});

const DZD_COMPACT = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

export function formatDzd(amount: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return "— DZD";
  if (opts.compact && Math.abs(amount) >= 10_000) {
    return `${DZD_COMPACT.format(amount)} DZD`;
  }
  return `${DZD_FULL.format(amount)} DZD`;
}

export function formatDzdPlain(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  return DZD_FULL.format(amount);
}

export function parseDzd(input: string): number {
  const normalized = input.replace(/\s/g, "").replace(/DZD/gi, "").replace(",", ".").trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}
