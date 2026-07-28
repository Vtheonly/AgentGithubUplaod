/**
 * Pricing tab — admin configuration of all billing amounts.
 *
 * Per plan §"Administration": all pricing is admin-configurable.
 * Adding/changing a price must NEVER require source code changes.
 *
 * Layout: 5 cards (Tuition / Transport / Registration / Monthly / Penalties)
 *         + 2 lists (Discounts / Additional Services) with add/remove actions.
 *
 * Edit is gated by `Permission.ManagePricing` — SuperAdmin by default.
 * FinancialOfficer can view but the inputs are disabled.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, Save, RotateCcw, Tag, Percent } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { Permission } from "../../core/rbac/permissions";
import { formatDzd } from "../../core/format/currency";
import {
  LEVEL_LABELS_FR,
  type AcademicLevel,
} from "../../domain/model/student";
import type { DiscountType } from "../../domain/model/pricing";
import { DISCOUNT_TYPE_LABELS_FR, tuitionTranches } from "../../domain/model/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { FormField } from "../../shared/components/form-field";
import { MoneyInput } from "../../shared/components/money-input";
import { ConfirmDialog } from "../../shared/components/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";

export function PricingTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useObservable(() => repos.pricing.observe(), []);
  const [pendingRemoval, setPendingRemoval] = useState<{ kind: "discount" | "service"; id: string; label: string } | null>(null);

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  // Local editable state synced from observable
  const [tuition, setTuition] = useState(config.tuitionByLevel);
  const [transport, setTransport] = useState(config.transportByTier);
  const [registration, setRegistration] = useState(config.registrationFee);
  const [monthly, setMonthly] = useState(config.monthlyByLevel);
  const [penalty, setPenalty] = useState(config.latePenaltyPerDay);

  useEffect(() => {
    setTuition(config.tuitionByLevel);
    setTransport(config.transportByTier);
    setRegistration(config.registrationFee);
    setMonthly(config.monthlyByLevel);
    setPenalty(config.latePenaltyPerDay);
  }, [config]);

  async function saveTuition() {
    const levels: AcademicLevel[] = ["primaire", "cem", "lycee"];
    for (const lvl of levels) {
      const r = await repos.pricing.updateTuition(lvl, tuition[lvl], actorId);
      if (!r.ok) {
        toast.showError("Échec de la mise à jour", r.error.userMessage);
        return;
      }
    }
    toast.showSuccess("Tarifs scolarité enregistrés");
  }

  async function saveTransport() {
    const tiers: Array<"t1" | "t2" | "t3"> = ["t1", "t2", "t3"];
    for (const t of tiers) {
      const r = await repos.pricing.updateTransport(t, transport[t], actorId);
      if (!r.ok) {
        toast.showError("Échec de la mise à jour", r.error.userMessage);
        return;
      }
    }
    toast.showSuccess("Tarifs transport enregistrés");
  }

  async function saveRegistration() {
    const r = await repos.pricing.updateRegistration(registration, actorId);
    if (r.ok) toast.showSuccess("Frais d'inscription enregistré");
    else toast.showError("Échec", r.error.userMessage);
  }

  async function saveMonthly() {
    const levels: AcademicLevel[] = ["primaire", "cem", "lycee"];
    for (const lvl of levels) {
      const amount = monthly[lvl] ?? 0;
      const r = await repos.pricing.updateMonthly(lvl, amount, actorId);
      if (!r.ok) {
        toast.showError("Échec", r.error.userMessage);
        return;
      }
    }
    toast.showSuccess("Mensualités enregistrées");
  }

  async function savePenalty() {
    const r = await repos.pricing.updateLatePenalty(penalty, actorId);
    if (r.ok) toast.showSuccess("Pénalité enregistrée");
    else toast.showError("Échec", r.error.userMessage);
  }

  async function confirmRemoval() {
    if (!pendingRemoval) return;
    if (pendingRemoval.kind === "discount") {
      await repos.pricing.removeDiscount(pendingRemoval.id, actorId);
      toast.showSuccess("Remise supprimée");
    } else {
      await repos.pricing.removeAdditionalService(pendingRemoval.id, actorId);
      toast.showSuccess("Service supprimé");
    }
    setPendingRemoval(null);
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {!canEdit && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-status-warning">
          Vous avez accès en lecture seule. Seul un Super Administrateur peut modifier la tarification.
        </div>
      )}

      {/* Tuition */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scolarité (par niveau)</CardTitle>
          <CardDescription>
            Montant annuel par niveau. La scolarité est divisée en 3 tranches automatiquement (plan §07.03).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["primaire", "cem", "lycee"] as const).map((lvl) => (
            <div key={lvl} className="grid grid-cols-[120px_1fr] items-center gap-3">
              <Label>{LEVEL_LABELS_FR[lvl]}</Label>
              <div className="flex items-center gap-2">
                <MoneyInput
                  value={tuition[lvl]}
                  onChange={(n) => setTuition({ ...tuition, [lvl]: n })}
                  disabled={!canEdit}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {/* Iteration 5: use tuitionTranches() — single source of truth for tranche math */}
                  3 × {formatDzd(tuitionTranches(tuition[lvl])[0].amountDue, { compact: true })}
                </span>
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={saveTuition} disabled={!canEdit}>
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transport */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transport (par zone)</CardTitle>
          <CardDescription>
            Tarifs par zone de résidence. T1 = urbaine / T2 = périurbaine / T3 = rurale.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["t1", "t2", "t3"] as const).map((tier) => (
            <div key={tier} className="grid grid-cols-[120px_1fr] items-center gap-3">
              <Label>
                {tier === "t1" ? "Zone urbaine (T1)" : tier === "t2" ? "Zone périurbaine (T2)" : "Zone rurale (T3)"}
              </Label>
              <MoneyInput
                value={transport[tier]}
                onChange={(n) => setTransport({ ...transport, [tier]: n })}
                disabled={!canEdit}
              />
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={saveTransport} disabled={!canEdit}>
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Registration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Frais d'inscription</CardTitle>
            <CardDescription>Montant unique, facturé à la première inscription.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <MoneyInput value={registration} onChange={setRegistration} disabled={!canEdit} />
            <div className="flex justify-end">
              <Button size="sm" onClick={saveRegistration} disabled={!canEdit}>
                <Save className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Monthly */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mensualités (optionnel)</CardTitle>
            <CardDescription>Option paiement mensuel par niveau.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(["primaire", "cem", "lycee"] as const).map((lvl) => (
              <div key={lvl} className="grid grid-cols-[100px_1fr] items-center gap-2">
                <Label className="text-xs">{LEVEL_LABELS_FR[lvl]}</Label>
                <MoneyInput
                  value={monthly[lvl] ?? 0}
                  onChange={(n) => setMonthly({ ...monthly, [lvl]: n })}
                  disabled={!canEdit}
                />
              </div>
            ))}
            <div className="flex justify-end">
              <Button size="sm" onClick={saveMonthly} disabled={!canEdit}>
                <Save className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Penalties */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pénalités de retard</CardTitle>
          <CardDescription>Montant facturé par jour de retard au-delà de l'échéance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <MoneyInput value={penalty} onChange={setPenalty} disabled={!canEdit} />
          <p className="text-[11px] text-muted-foreground">
            Exemple: 30 jours de retard = {formatDzd(penalty * 30)}
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={savePenalty} disabled={!canEdit}>
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Discounts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Percent className="h-4 w-4 text-primary" /> Remises
              </CardTitle>
              <CardDescription>Codes de remise applicables aux facturations.</CardDescription>
            </div>
            {canEdit && <AddDiscountButton />}
          </div>
        </CardHeader>
        <CardContent>
          {config.discounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucune remise configurée.</p>
          ) : (
            <ul className="divide-y divide-border">
              {config.discounts.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{d.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{d.qualifier}</p>
                  </div>
                  <Badge variant="default">
                    {d.discountType === "percentage" ? `${d.amount}%` : formatDzd(d.amount)}
                  </Badge>
                  <Badge variant="outline">{DISCOUNT_TYPE_LABELS_FR[d.discountType ?? "percentage"]}</Badge>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-status-danger"
                      onClick={() => setPendingRemoval({ kind: "discount", id: d.id, label: d.label })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Additional services */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" /> Services additionnels
              </CardTitle>
              <CardDescription>Cantine, uniforme, livres, clubs, thérapie, etc.</CardDescription>
            </div>
            {canEdit && <AddServiceButton />}
          </div>
        </CardHeader>
        <CardContent>
          {config.additionalServices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucun service configuré.</p>
          ) : (
            <ul className="divide-y divide-border">
              {config.additionalServices.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{s.qualifier}</p>
                  </div>
                  <Badge variant="success">{formatDzd(s.amount)}</Badge>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-status-danger"
                      onClick={() => setPendingRemoval({ kind: "service", id: s.id, label: s.label })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!pendingRemoval}
        onOpenChange={(o) => !o && setPendingRemoval(null)}
        title="Confirmer la suppression"
        description={`Supprimer "${pendingRemoval?.label}" ? Cette action est définitive et sera tracée dans le journal d'audit.`}
        destructive
        confirmLabel="Supprimer"
        onConfirm={confirmRemoval}
      />
    </div>
  );
}

// ============================================================
// Add Discount modal
// ============================================================
function AddDiscountButton() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<DiscountType>("percentage");

  async function submit() {
    if (!label.trim() || amount <= 0) {
      toast.showWarning("Champs invalides", "Libellé et montant sont requis.");
      return;
    }
    if (type === "percentage" && amount > 100) {
      toast.showWarning("Pourcentage invalide", "Le pourcentage doit être ≤ 100.");
      return;
    }
    const r = await repos.pricing.addDiscount(
      { label: label.trim(), amount: type === "fixed_amount" ? -Math.abs(amount) : amount, discountType: type },
      session?.userId ?? "usr-current",
    );
    if (r.ok) {
      toast.showSuccess("Remise ajoutée");
      setOpen(false);
      setLabel("");
      setAmount(0);
      setType("percentage");
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Ajouter
      </Button>
      {open && (
        <SimpleDialog open={open} onOpenChange={setOpen} title="Nouvelle remise" onSubmit={submit}>
          <FormField label="Libellé" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Fratrie — 4ème enfant (-20%)" />
          </FormField>
          <FormField label="Type" required>
            <Select value={type} onValueChange={(v) => setType(v as DiscountType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">{DISCOUNT_TYPE_LABELS_FR.percentage}</SelectItem>
                <SelectItem value="fixed_amount">{DISCOUNT_TYPE_LABELS_FR.fixed_amount}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label={type === "percentage" ? "Pourcentage (%)" : "Montant fixe (DZD)"}
            required
            hint={type === "fixed_amount" ? "Sera soustrait du total." : undefined}
          >
            <MoneyInput value={amount} onChange={setAmount} />
          </FormField>
        </SimpleDialog>
      )}
    </>
  );
}

// ============================================================
// Add Service modal
// ============================================================
function AddServiceButton() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState(0);

  async function submit() {
    if (!label.trim() || amount <= 0) {
      toast.showWarning("Champs invalides", "Libellé et montant sont requis.");
      return;
    }
    const r = await repos.pricing.addAdditionalService(
      { label: label.trim(), amount },
      session?.userId ?? "usr-current",
    );
    if (r.ok) {
      toast.showSuccess("Service ajouté");
      setOpen(false);
      setLabel("");
      setAmount(0);
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Ajouter
      </Button>
      {open && (
        <SimpleDialog open={open} onOpenChange={setOpen} title="Nouveau service additionnel" onSubmit={submit}>
          <FormField label="Libellé" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Club de robotique" />
          </FormField>
          <FormField label="Montant" required>
            <MoneyInput value={amount} onChange={setAmount} />
          </FormField>
        </SimpleDialog>
      )}
    </>
  );
}

// ============================================================
// Shared simple dialog wrapper for the add forms above
// Iteration 4: migrated from raw Dialog to UnifiedModal so these
// add-form modals share the exact same chrome as every other modal.
// ============================================================
import { UnifiedModal } from "../../shared/components/unified-modal";

function SimpleDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="sm"
      icon={Plus}
      iconTone="primary"
      title={title}
      description={description}
      submitLabel="Enregistrer"
      submitIcon={Save}
      onSubmit={onSubmit}
    >
      <div className="space-y-3">{children}</div>
    </UnifiedModal>
  );
}
