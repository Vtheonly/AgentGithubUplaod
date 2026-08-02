/**
 * Fees card — Frais fixes & pénalités.
 *
 * Registration fee, monthly fees per level (primaire / cem / lycee),
 * late penalty per day, and 2nd apron surcharge.
 *
 * Extracted from `pricing-tab.tsx` (iteration 6-a). Behavior preserved
 * exactly — only file location + import paths changed.
 */
import { useEffect, useState } from "react";
import { Wallet, Save } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { Permission } from "../../../core/rbac/permissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { FormField } from "../../../shared/ui/form-field";
import { MoneyInput } from "../../../shared/ui/money-input";

export function FeesCard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useRepositories().pricing.observe().get();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const ok = (msg: string) => toast.showSuccess(msg);
  const fail = (title: string, msg: string) => toast.showError(title, msg);

  const [registration, setRegistration] = useState(config.registrationFee);
  const [monthlyPrimaire, setMonthlyPrimaire] = useState(config.monthlyByLevel.primaire ?? 0);
  const [monthlyCem, setMonthlyCem] = useState(config.monthlyByLevel.cem ?? 0);
  const [monthlyLycee, setMonthlyLycee] = useState(config.monthlyByLevel.lycee ?? 0);
  const [penalty, setPenalty] = useState(config.latePenaltyPerDay);
  const [secondApron, setSecondApron] = useState(config.secondApronFee);

  useEffect(() => {
    setRegistration(config.registrationFee);
    setMonthlyPrimaire(config.monthlyByLevel.primaire ?? 0);
    setMonthlyCem(config.monthlyByLevel.cem ?? 0);
    setMonthlyLycee(config.monthlyByLevel.lycee ?? 0);
    setPenalty(config.latePenaltyPerDay);
    setSecondApron(config.secondApronFee);
  }, [config]);

  async function saveRegistration() {
    const r = await repos.pricing.updateRegistration(registration, actorId);
    if (r.ok) ok("Frais d'inscription enregistré");
    else fail("Échec", r.error.userMessage);
  }
  async function saveMonthly() {
    const levels: Array<["primaire" | "cem" | "lycee", number]> = [
      ["primaire", monthlyPrimaire],
      ["cem", monthlyCem],
      ["lycee", monthlyLycee],
    ];
    for (const [lvl, amt] of levels) {
      const r = await repos.pricing.updateMonthly(lvl, amt, actorId);
      if (!r.ok) { fail("Échec", r.error.userMessage); return; }
    }
    ok("Mensualités enregistrées");
  }
  async function savePenalty() {
    const r = await repos.pricing.updateLatePenalty(penalty, actorId);
    if (r.ok) ok("Pénalité de retard enregistrée");
    else fail("Échec", r.error.userMessage);
  }
  async function saveSecondApron() {
    const r = await repos.pricing.updateSecondApronFee(secondApron, actorId);
    if (r.ok) ok("2ème tablier enregistré");
    else fail("Échec", r.error.userMessage);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-5 text-primary" />
          Frais fixes & pénalités
        </CardTitle>
        <CardDescription>
          Frais d'inscription, mensualités par palier, pénalité de retard, 2ème tablier.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface-panel/50 p-4 space-y-3">
          <FormField label="Frais d'inscription (DA)" required>
            <MoneyInput value={registration} onChange={setRegistration} disabled={!canEdit} />
          </FormField>
          <Button size="sm" variant="default" disabled={!canEdit} onClick={saveRegistration}>
            <Save className="size-3.5 mr-1.5" />
            Enregistrer
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-surface-panel/50 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <FormField label="Mens. Primaire">
              <MoneyInput value={monthlyPrimaire} onChange={setMonthlyPrimaire} disabled={!canEdit} />
            </FormField>
            <FormField label="Mens. CEM">
              <MoneyInput value={monthlyCem} onChange={setMonthlyCem} disabled={!canEdit} />
            </FormField>
            <FormField label="Mens. Lycée">
              <MoneyInput value={monthlyLycee} onChange={setMonthlyLycee} disabled={!canEdit} />
            </FormField>
          </div>
          <Button size="sm" variant="default" disabled={!canEdit} onClick={saveMonthly}>
            <Save className="size-3.5 mr-1.5" />
            Enregistrer
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-surface-panel/50 p-4 space-y-3">
          <FormField label="Pénalité de retard par jour (DA)" required>
            <MoneyInput value={penalty} onChange={setPenalty} disabled={!canEdit} />
          </FormField>
          <Button size="sm" variant="default" disabled={!canEdit} onClick={savePenalty}>
            <Save className="size-3.5 mr-1.5" />
            Enregistrer
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-surface-panel/50 p-4 space-y-3">
          <FormField label="2ème tablier (DA)" required>
            <MoneyInput value={secondApron} onChange={setSecondApron} disabled={!canEdit} />
          </FormField>
          <Button size="sm" variant="default" disabled={!canEdit} onClick={saveSecondApron}>
            <Save className="size-3.5 mr-1.5" />
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
