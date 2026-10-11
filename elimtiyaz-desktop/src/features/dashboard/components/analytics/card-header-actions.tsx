// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/card-header-actions.tsx
// ============================================================================
/**
 * CardHeaderActions — T-503 (UI-334): the ONE reusable attachment surface for
 * a card's inspection controls.
 *
 * The owner's mandate: "Attach each inspection button directly to the graph,
 * gauge, or meter it is intended to inspect, rather than leaving it floating
 * above or disconnected from its target. Make the relationship between each
 * inspection button and its associated component immediately obvious."
 *
 * Before this surface, the Analytics tab carried its InspectTrigger chips in
 * three dedicated "strip" layout cells and in justify-end rows stacked ABOVE
 * the cards — the inspection layer was a SIBLING of the card layer. Every
 * analytics card now accepts an optional `headerActions` node and renders it
 * through THIS wrapper inside its own header: the button lives ON the card it
 * inspects, wraps with the header at every width (the headers are flex-wrap),
 * and stays attached through drags/resizes/hides (the card and its buttons
 * are one layout item).
 *
 * Usage (the cards' uniform pattern):
 *   <CardHeader className="… flex flex-row items-center justify-between flex-wrap gap-2">
 *     <div>…title…</div>
 *     <CardHeaderActions>{headerActions}</CardHeaderActions>
 *   </CardHeader>
 */
import type { ReactNode } from "react";

export function CardHeaderActions({ children }: { children?: ReactNode }) {
  // Honest-empty: no node, no wrapper (the card's header renders exactly as
  // it did before the surface existed).
  if (!children) return null;
  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      data-testid="card-header-actions"
    >
      {children}
    </div>
  );
}
