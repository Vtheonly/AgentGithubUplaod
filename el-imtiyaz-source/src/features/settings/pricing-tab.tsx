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
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, Save, RotateCcw, Tag, Percent, BookOpen, Bus, Wallet, Stethoscope, Award, Package } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { Permission } from "../../core/rbac/permissions";
import { formatDzd } from "../../core/format/currency";
import {
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  type GradeLevel,
} from "../../domain/model/student";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
} from "../../domain/model/parent";
import type {
  PricingConfig,
  PricingEntry,
  DiscountType,
  DiscountCode,
} from "../../domain/model/pricing";
import {
  DISCOUNT_TYPE_LABELS_FR,
  DISCOUNT_CODE_LABELS_FR,
  tuitionTranchesForGrade,
  transportTranchesForDestination,
} from "../../domain/model/pricing";
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
  const config = useRepositories().pricing.observe().get();
  const [pendingRemoval, setPendingRemoval] = useState<{ kind: "discount" | "service" | "complementary"; id: string; label: string } | null>(null);

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  // Helper for showing a success toast.
  const ok = (msg: string) => toast.showSuccess(msg);
  const fail = (title: string, msg: string) => toast.showError(title, msg);

  // -----------------------------------------------------------------------
  // Tuition (per grade level)
  // -----------------------------------------------------------------------
  const [tuitionDrafts, setTuitionDrafts] = useState<Record<GradeLevel, { annual: number; t1: number; t2: number; t3: number }>>(() => {
    const out = {} as Record<GradeLevel, { annual: number; t1: number; t2: number; t3: number }>;
    for (const g of GRADE_LEVELS) {
      const p = config.tuitionByGradeLevel[g] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      out[g] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    return out;
  });

  useEffect(() => {
    const next = {} as Record<GradeLevel, { annual: number; t1: number; t2: number; t3: number }>;
    for (const g of GRADE_LEVELS) {
      const p = config.tuitionByGradeLevel[g] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      next[g] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    setTuitionDrafts(next);
  }, [config]);

  async function saveTuitionForGrade(g: GradeLevel) {
    const d = tuitionDrafts[g];
    const r = await repos.pricing.updateTuitionForGradeLevel(g, d.annual, [d.t1, d.t2, d.t3], actorId);
    if (r.ok) ok(`Scolarité ${GRADE_LEVEL_LABELS_FR[g]} enregistrée`);
    else fail("Échec", r.error.userMessage);
  }

  // -----------------------------------------------------------------------
  // Transport (per destination)
  // -----------------------------------------------------------------------
  const [transportDrafts, setTransportDrafts] = useState<Record<TransportDestination, { annual: number; t1: number; t2: number; t3: number }>>(() => {
    const out = {} as Record<TransportDestination, { annual: number; t1: number; t2: number; t3: number }>;
    for (const d of TRANSPORT_DESTINATIONS) {
      const p = config.transportByDestination[d] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      out[d] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    return out;
  });

  useEffect(() => {
    const next = {} as Record<TransportDestination, { annual: number; t1: number; t2: number; t3: number }>;
    for (const d of TRANSPORT_DESTINATIONS) {
      const p = config.transportByDestination[d] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      next[d] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    setTransportDrafts(next);
  }, [config]);

  async function saveTransportForDestination(d: TransportDestination) {
    const draft = transportDrafts[d];
    const r = await repos.pricing.updateTransportForDestination(d, draft.annual, [draft.t1, draft.t2, draft.t3], actorId);
    if (r.ok) ok(`Transport ${TRANSPORT_DESTINATION_LABELS_FR[d]} enregistré`);
    else fail("Échec", r.error.userMessage);
  }

  // -----------------------------------------------------------------------
  // Registration / Monthly / Penalties / 2nd Apron
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // Discounts
  // -----------------------------------------------------------------------
  const [newDiscount, setNewDiscount] = useState<{ label: string; amount: number; discountType: DiscountType; discountCode: DiscountCode }>({
    label: "",
    amount: 0,
    discountType: "percentage",
    discountCode: "custom",
  });

  async function addDiscount() {
    if (!newDiscount.label.trim()) { fail("Champ manquant", "Libellé requis"); return; }
    const r = await repos.pricing.addDiscount(newDiscount, actorId);
    if (r.ok) {
      ok("Remise ajoutée");
      setNewDiscount({ label: "", amount: 0, discountType: "percentage", discountCode: "custom" });
    } else fail("Échec", r.error.userMessage);
  }

  async function removeDiscount(id: string) {
    const r = await repos.pricing.removeDiscount(id, actorId);
    if (r.ok) ok("Remise supprimée");
    else fail("Échec", r.error.userMessage);
  }

  // -----------------------------------------------------------------------
  // Complementary services
  // -----------------------------------------------------------------------
  const [newComplementary, setNewComplementary] = useState<{ label: string; qualifier: string; semesterAmount: number; annualAmount: number }>({
    label: "",
    qualifier: "",
    semesterAmount: 0,
    annualAmount: 0,
  });

  async function addComplementary() {
    if (!newComplementary.label.trim()) { fail("Champ manquant", "Libellé requis"); return; }
    if (!newComplementary.qualifier.trim()) { fail("Champ manquant", "Identifiant (qualifier) requis"); return; }
    const r = await repos.pricing.addComplementaryService(newComplementary, actorId);
    if (r.ok) {
      ok("Service complémentaire ajouté");
      setNewComplementary({ label: "", qualifier: "", semesterAmount: 0, annualAmount: 0 });
    } else fail("Échec", r.error.userMessage);
  }

  async function removeComplementary(id: string) {
    const r = await repos.pricing.removeComplementaryService(id, actorId);
    if (r.ok) ok("Service complémentaire supprimé");
    else fail("Échec", r.error.userMessage);
  }

  // -----------------------------------------------------------------------
  // Additional services
  // -----------------------------------------------------------------------
  const [newService, setNewService] = useState<{ label: string; amount: number }>({ label: "", amount: 0 });

  async function addService() {
    if (!newService.label.trim()) { fail("Champ manquant", "Libellé requis"); return; }
    const r = await repos.pricing.addAdditionalService(newService, actorId);
    if (r.ok) {
      ok("Service additionnel ajouté");
      setNewService({ label: "", amount: 0 });
    } else fail("Échec", r.error.userMessage);
  }

  async function removeService(id: string) {
    const r = await repos.pricing.removeAdditionalService(id, actorId);
    if (r.ok) ok("Service additionnel supprimé");
    else fail("Échec", r.error.userMessage);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Tuition card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            Scolarité par palier (14 niveaux)
          </CardTitle>
          <CardDescription>
            Tarifs annuels 2026-2027 — chaque palier a son propre découpage en 3 tranches (inscription / janvier / avril).
            Les montants doivent correspondre à la grille officielle de l'établissement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {GRADE_LEVELS.map((g) => {
            const draft = tuitionDrafts[g];
            const tranches = tuitionTranchesForGrade(config, g);
            const saved = tranches.map((t) => t.amountDue);
            const isDirty = draft.annual !== (config.tuitionByGradeLevel[g]?.annualAmount ?? 0)
              || draft.t1 !== saved[0]
              || draft.t2 !== saved[1]
              || draft.t3 !== saved[2];
            return (
              <div key={g} className="rounded-lg border border-border bg-surface-panel/50 p-4">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-medium text-bright">{GRADE_LEVEL_LABELS_FR[g]}</div>
                    <div className="text-xs text-muted">Annuel enregistré : {formatDzd(config.tuitionByGradeLevel[g]?.annualAmount ?? 0)}</div>
                  </div>
                  <Badge variant={isDirty ? "warning" : "neutral"}>{isDirty ? "Non enregistré" : "À jour"}</Badge>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!canEdit || !isDirty}
                    onClick={() => saveTuitionForGrade(g)}
                  >
                    <Save className="size-3.5 mr-1.5" />
                    Enregistrer
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <FormField label="Montant annuel (DA)" required>
                    <MoneyInput
                      value={draft.annual}
                      onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, annual: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                  <FormField label="Tranche 1 (Sept–Déc)">
                    <MoneyInput
                      value={draft.t1}
                      onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t1: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                  <FormField label="Tranche 2 (Jan–Mar)">
                    <MoneyInput
                      value={draft.t2}
                      onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t2: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                  <FormField label="Tranche 3 (Avr–Juin)">
                    <MoneyInput
                      value={draft.t3}
                      onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t3: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                </div>
                <div className="text-xs text-muted mt-2">
                  Somme des tranches : {formatDzd(draft.t1 + draft.t2 + draft.t3)}
                  {Math.abs(draft.t1 + draft.t2 + draft.t3 - draft.annual) > 1 && (
                    <span className="text-status-danger ml-2">⚠︎ La somme ne correspond pas au montant annuel</span>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Transport card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bus className="size-5 text-primary" />
            Transport scolaire (4 destinations)
          </CardTitle>
          <CardDescription>
            Chaque destination a son propre découpage en 3 tranches :
            <span className="text-bright"> à l'inscription</span> /
            <span className="text-bright"> 01–15 Déc</span> /
            <span className="text-bright"> 01–15 Mar</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TRANSPORT_DESTINATIONS.map((d) => {
            const draft = transportDrafts[d];
            const tranches = transportTranchesForDestination(config, d);
            const saved = tranches.map((t) => t.amountDue);
            const isDirty = draft.annual !== (config.transportByDestination[d]?.annualAmount ?? 0)
              || draft.t1 !== saved[0]
              || draft.t2 !== saved[1]
              || draft.t3 !== saved[2];
            return (
              <div key={d} className="rounded-lg border border-border bg-surface-panel/50 p-4">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium text-bright">{TRANSPORT_DESTINATION_LABELS_FR[d]}</div>
                    <div className="text-xs text-muted">Annuel enregistré : {formatDzd(config.transportByDestination[d]?.annualAmount ?? 0)}</div>
                  </div>
                  <Badge variant={isDirty ? "warning" : "neutral"}>{isDirty ? "Non enregistré" : "À jour"}</Badge>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!canEdit || !isDirty}
                    onClick={() => saveTransportForDestination(d)}
                  >
                    <Save className="size-3.5 mr-1.5" />
                    Enregistrer
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <FormField label="Montant annuel (DA)" required>
                    <MoneyInput
                      value={draft.annual}
                      onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, annual: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                  <FormField label="Tranche 1 (À l'inscription)">
                    <MoneyInput
                      value={draft.t1}
                      onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, t1: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                  <FormField label="Tranche 2 (01–15 Déc)">
                    <MoneyInput
                      value={draft.t2}
                      onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, t2: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                  <FormField label="Tranche 3 (01–15 Mar)">
                    <MoneyInput
                      value={draft.t3}
                      onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, t3: v } })}
                      disabled={!canEdit}
                    />
                  </FormField>
                </div>
                <div className="text-xs text-muted mt-2">
                  Somme des tranches : {formatDzd(draft.t1 + draft.t2 + draft.t3)}
                  {Math.abs(draft.t1 + draft.t2 + draft.t3 - draft.annual) > 1 && (
                    <span className="text-status-danger ml-2">⚠︎ La somme ne correspond pas au montant annuel</span>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Registration / Monthly / Penalties / 2nd Apron */}
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

      {/* Complementary services */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="size-5 text-primary" />
            Services complémentaires (semestriel & annuel)
          </CardTitle>
          <CardDescription>
            Psychologie, orthophonie — chaque service propose une formule semestrielle et une formule annuelle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {config.complementaryServices.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-panel/50 p-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-bright">{s.label}</div>
                  <div className="text-xs text-muted">Identifiant : {s.qualifier}</div>
                </div>
                <Badge variant="info">Semestre : {formatDzd(s.semesterAmount)}</Badge>
                <Badge variant="success">Annuel : {formatDzd(s.annualAmount)}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() => setPendingRemoval({ kind: "complementary", id: s.id, label: s.label })}
                >
                  <Trash2 className="size-4 text-status-danger" />
                </Button>
              </div>
            ))}
            {config.complementaryServices.length === 0 && (
              <div className="text-sm text-muted italic">Aucun service complémentaire configuré.</div>
            )}
          </div>

          {canEdit && (
            <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
              <div className="text-sm font-medium">Ajouter un service complémentaire</div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <FormField label="Libellé" required>
                  <Input
                    value={newComplementary.label}
                    onChange={(e) => setNewComplementary({ ...newComplementary, label: e.target.value })}
                    placeholder="Ex. Séances de psychologie (20 séances)"
                  />
                </FormField>
                <FormField label="Identifiant (qualifier)" required>
                  <Input
                    value={newComplementary.qualifier}
                    onChange={(e) => setNewComplementary({ ...newComplementary, qualifier: e.target.value })}
                    placeholder="Ex. psychology"
                  />
                </FormField>
                <FormField label="Montant semestriel (DA)">
                  <MoneyInput
                    value={newComplementary.semesterAmount}
                    onChange={(v) => setNewComplementary({ ...newComplementary, semesterAmount: v })}
                  />
                </FormField>
                <FormField label="Montant annuel (DA)">
                  <MoneyInput
                    value={newComplementary.annualAmount}
                    onChange={(v) => setNewComplementary({ ...newComplementary, annualAmount: v })}
                  />
                </FormField>
              </div>
              <Button size="sm" variant="default" onClick={addComplementary}>
                <Plus className="size-3.5 mr-1.5" />
                Ajouter
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Discounts card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="size-5 text-primary" />
            Remises
          </CardTitle>
          <CardDescription>
            5 codes canoniques (passage de palier, ancienneté, paiement annuel, meilleure moyenne, fratrie) plus remises personnalisées.
            Pour les remises fixes, saisir un montant négatif (ex. -10000).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {config.discounts.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-panel/50 p-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-bright">{d.label}</div>
                  <div className="text-xs text-muted">
                    Code : <code className="font-mono">{d.discountCode ?? "custom"}</code> · Type : {DISCOUNT_TYPE_LABELS_FR[d.discountType ?? "percentage"]}
                  </div>
                </div>
                <Badge variant={d.discountType === "percentage" ? "info" : "warning"}>
                  {d.discountType === "percentage" ? <Percent className="size-3 mr-1" /> : <Tag className="size-3 mr-1" />}
                  {d.discountType === "percentage" ? `${d.amount}%` : formatDzd(d.amount)}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() => setPendingRemoval({ kind: "discount", id: d.id, label: d.label })}
                >
                  <Trash2 className="size-4 text-status-danger" />
                </Button>
              </div>
            ))}
            {config.discounts.length === 0 && (
              <div className="text-sm text-muted italic">Aucune remise configurée.</div>
            )}
          </div>

          {canEdit && (
            <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
              <div className="text-sm font-medium">Ajouter une remise</div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <FormField label="Libellé" required>
                  <Input
                    value={newDiscount.label}
                    onChange={(e) => setNewDiscount({ ...newDiscount, label: e.target.value })}
                    placeholder="Ex. Remise personnalisée"
                  />
                </FormField>
                <FormField label="Code">
                  <Select
                    value={newDiscount.discountCode}
                    onValueChange={(v) => setNewDiscount({ ...newDiscount, discountCode: v as DiscountCode })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DISCOUNT_CODE_LABELS_FR) as DiscountCode[]).map((code) => (
                        <SelectItem key={code} value={code}>{DISCOUNT_CODE_LABELS_FR[code]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Type">
                  <Select
                    value={newDiscount.discountType}
                    onValueChange={(v) => setNewDiscount({ ...newDiscount, discountType: v as DiscountType })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Pourcentage</SelectItem>
                      <SelectItem value="fixed_amount">Montant fixe (négatif)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={newDiscount.discountType === "percentage" ? "Pourcentage (%)" : "Montant (DA, négatif)"}>
                  <MoneyInput
                    value={newDiscount.amount}
                    onChange={(v) => setNewDiscount({ ...newDiscount, amount: v })}
                  />
                </FormField>
              </div>
              <Button size="sm" variant="default" onClick={addDiscount}>
                <Plus className="size-3.5 mr-1.5" />
                Ajouter
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Additional services card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="size-5 text-primary" />
            Services additionnels
          </CardTitle>
          <CardDescription>
            Cantine, uniforme, livres, clubs, etc. — tarifs libres configurables par l'administrateur.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {config.additionalServices.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-panel/50 p-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-bright">{s.label}</div>
                  <div className="text-xs text-muted">Identifiant : {s.qualifier}</div>
                </div>
                <Badge variant="success">{formatDzd(s.amount)}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() => setPendingRemoval({ kind: "service", id: s.id, label: s.label })}
                >
                  <Trash2 className="size-4 text-status-danger" />
                </Button>
              </div>
            ))}
            {config.additionalServices.length === 0 && (
              <div className="text-sm text-muted italic">Aucun service additionnel configuré.</div>
            )}
          </div>

          {canEdit && (
            <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
              <div className="text-sm font-medium">Ajouter un service additionnel</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <FormField label="Libellé" required>
                  <Input
                    value={newService.label}
                    onChange={(e) => setNewService({ ...newService, label: e.target.value })}
                    placeholder="Ex. Sortie scolaire"
                  />
                </FormField>
                <FormField label="Montant (DA)" required>
                  <MoneyInput value={newService.amount} onChange={(v) => setNewService({ ...newService, amount: v })} />
                </FormField>
                <Button size="sm" variant="default" onClick={addService}>
                  <Plus className="size-3.5 mr-1.5" />
                  Ajouter
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm removal dialog */}
      <ConfirmDialog
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
