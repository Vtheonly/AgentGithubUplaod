/**
 * Pricing tab — admin configuration of all billing amounts.
 *
 * Per plan §"Administration": all pricing is admin-configurable.
 * Adding/changing a price must NEVER require source code changes.
 *
 * Iteration 6 layout:
 *   1. Tuition card — per-grade-level (14 grades) with 3-tranche editor
 *   2. Transport card — per-destination (4 destinations) with 3-tranche editor
 *   3. Registration / Monthly / Penalties card
 *   4. 2nd Apron surcharge card
 *   5. Complementary services card (psychology, speech therapy — semester + annual)
 *   6. Discounts card (5 canonical codes + custom)
 *   7. Additional services card (canteen, uniform, books, clubs, etc.)
 *
 * Edit is gated by `Permission.ManagePricing` — SuperAdmin by default.
 * FinancialOfficer can view but the inputs are disabled.
 *
 * Iteration 6-a: each card now lives in its own file under `./pricing/`.
 * This orchestrator only owns the cross-card "pending removal" flow (the
 * `ConfirmModal` + the three `repos.pricing.removeX` async handlers) and
 * the `canEdit` / `actorId` derivation shared with the removal handlers.
 */
import { useState } from "react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { TuitionCard } from "./pricing/tuition-card";
import { TransportCard } from "./pricing/transport-card";
import { FeesCard } from "./pricing/fees-card";
import { ComplementaryServicesCard } from "./pricing/complementary-services-card";
import { DiscountsCard } from "./pricing/discounts-card";
import { AdditionalServicesCard } from "./pricing/additional-services-card";
import type { PendingRemoval } from "./pricing/types";

export function PricingTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  const actorId = session?.userId ?? "usr-current";
  const ok = (msg: string) => toast.showSuccess(msg);
  const fail = (title: string, msg: string) => toast.showError(title, msg);

  async function removeDiscount(id: string) {
    const r = await repos.pricing.removeDiscount(id, actorId);
    if (r.ok) ok("Remise supprimée");
    else fail("Échec", r.error.userMessage);
  }

  async function removeComplementary(id: string) {
    const r = await repos.pricing.removeComplementaryService(id, actorId);
    if (r.ok) ok("Service complémentaire supprimé");
    else fail("Échec", r.error.userMessage);
  }

  async function removeService(id: string) {
    const r = await repos.pricing.removeAdditionalService(id, actorId);
    if (r.ok) ok("Service additionnel supprimé");
    else fail("Échec", r.error.userMessage);
  }

  return (
    <div className="space-y-6">
      <TuitionCard />
      <TransportCard />
      <FeesCard />
      <ComplementaryServicesCard onRequestRemoval={setPendingRemoval} />
      <DiscountsCard onRequestRemoval={setPendingRemoval} />
      <AdditionalServicesCard onRequestRemoval={setPendingRemoval} />

      {/* Confirm removal dialog */}
      <ConfirmModal
        open={pendingRemoval !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}
        title="Confirmer la suppression"
        description={`Voulez-vous vraiment supprimer « ${pendingRemoval?.label ?? ""} » ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        onConfirm={() => {
          if (!pendingRemoval) return;
          const removal = pendingRemoval;
          setPendingRemoval(null);
          // Fire and forget — the toast will report the outcome.
          if (removal.kind === "discount") void removeDiscount(removal.id);
          else if (removal.kind === "service") void removeService(removal.id);
          else if (removal.kind === "complementary") void removeComplementary(removal.id);
        }}
      />
    </div>
  );
}
