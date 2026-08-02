/**
 * Transport pricing calculations — single source of truth for transport
 * lookups and tranche schedules.
 *
 * Extracted from `domain/model/pricing.ts`:
 *   - `transportForDestination`                — per-destination lookup
 *   - `transportForTier`                       — per-tier lookup (legacy fallback)
 *   - `transportTranchesForDestination`        — 3-tranche schedule for a destination
 *
 * Behavior preserved verbatim:
 *   - `transportForTier` delegates to `cityTierToDestination` for the
 *     tier → destination mapping, then calls `transportForDestination`.
 *   - Tranche labels are FR (preserved from original):
 *       * "Tranche 1 (À l'inscription)"
 *       * "Tranche 2 (01 Déc – 15 Déc)"
 *       * "Tranche 3 (01 Mar – 15 Mar)"
 */
import type { TransportDestination } from "@/domain/model/parent";
import { cityTierToDestination } from "@/domain/model/parent";
import type { PricingConfig, TransportPricing } from "@/domain/model/pricing";

/**
 * Convenience: look up transport pricing for a destination.
 *
 * Returns `{ annualAmount: 0, installments: [0, 0, 0] }` when the destination
 * is not configured — preserves original fallback semantics.
 */
export function transportForDestination(
  config: PricingConfig,
  destination: TransportDestination,
): TransportPricing {
  return (
    config.transportByDestination[destination] ?? {
      annualAmount: 0,
      installments: [0, 0, 0],
    }
  );
}

/**
 * Convenience: look up transport annual amount for a legacy tier.
 *
 * Delegates to `cityTierToDestination` for the tier → destination mapping,
 * then calls `transportForDestination`. Returns 0 when the tier maps to
 * no known destination (preserves original behavior).
 */
export function transportForTier(
  config: PricingConfig,
  tier: "t1" | "t2" | "t3",
): number {
  const destination = cityTierToDestination(tier);
  if (!destination) return 0;
  return transportForDestination(config, destination).annualAmount;
}

/**
 * Compute the 3-tranche schedule for transport given a destination.
 *
 * Tranche 1 is due at registration, Tranche 2 Dec 01–15, Tranche 3 Mar 01–15.
 */
export function transportTranchesForDestination(
  config: PricingConfig,
  destination: TransportDestination,
): ReadonlyArray<{ label: string; amountDue: number }> {
  const pricing = transportForDestination(config, destination);
  return [
    { label: "Tranche 1 (À l'inscription)", amountDue: pricing.installments[0] },
    { label: "Tranche 2 (01 Déc – 15 Déc)", amountDue: pricing.installments[1] },
    { label: "Tranche 3 (01 Mar – 15 Mar)", amountDue: pricing.installments[2] },
  ];
}
