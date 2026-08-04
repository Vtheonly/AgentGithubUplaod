/**
 * Shared types + constants for the pricing tab sub-components.
 *
 * The pricing tab orchestrator (`pricing-tab.tsx`) owns the cross-card
 * "pending removal" flow: when the user clicks a trash icon inside the
 * Complementary services / Discounts / Additional services cards, the card
 * calls `onRequestRemoval(...)` which sets `pendingRemoval` state on the
 * orchestrator; the orchestrator then opens the ConfirmModal and, on
 * confirmation, fires the actual `repos.pricing.removeX(...)` call.
 */
export type PendingRemoval = {
  kind: "discount" | "service" | "complementary";
  id: string;
  label: string;
};

export type RequestRemoval = (removal: PendingRemoval) => void;
