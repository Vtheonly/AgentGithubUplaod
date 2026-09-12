/**
 * Step 3 — Billing config (reads from PricingConfig).
 *
 * CALC-001 (2026-09-12): shows the REAL per-student breakdown —
 * FI (per student, per grade) + scolarité + transport − remise négociée,
 * the V2/2V/v3 tranche schedule (remise on V2 only), and the family-level
 * prior balances (REMBOURSEMENT / DETTES) collected at intake.
 * Pure presentational component — state and the `billing` useMemo live in
 * the orchestrator.
 */
import { formatDzd } from "../../../core/format/currency";
import type { Billing } from "./types";

export function Step3({
  billing,
  includeRegistration,
  setIncludeRegistration,
  includeTransport,
  setIncludeTransport,
  priorCredit,
  setPriorCredit,
  priorDebt,
  setPriorDebt,
}: {
  billing: Billing;
  includeRegistration: boolean;
  setIncludeRegistration: (b: boolean) => void;
  includeTransport: boolean;
  setIncludeTransport: (b: boolean) => void;
  priorCredit: string;
  setPriorCredit: (v: string) => void;
  priorDebt: string;
  setPriorDebt: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/5">
          <input
            type="checkbox"
            checked={includeRegistration}
            onChange={(e) => setIncludeRegistration(e.target.checked)}
            className="h-4 w-4"
          />
          <div>
            <p className="text-sm font-medium">Frais d'inscription (FI)</p>
            <p className="text-xs text-muted-foreground">
              Facturé PAR ÉLÈVE selon le niveau ({formatDzd(billing.registrationFee)} au total)
            </p>
          </div>
          <span className="ml-auto font-mono text-sm">{formatDzd(billing.registrationFee)}</span>
        </label>
        <label className="flex items-center gap-2 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/5">
          <input
            type="checkbox"
            checked={includeTransport}
            onChange={(e) => setIncludeTransport(e.target.checked)}
            className="h-4 w-4"
          />
          <div>
            <p className="text-sm font-medium">Transport scolaire</p>
            <p className="text-xs text-muted-foreground">Basé sur la commune de résidence</p>
          </div>
          <span className="ml-auto font-mono text-sm">{formatDzd(billing.totalTransport)}</span>
        </label>
      </div>

      {/* CALC-001 — prior balances at intake (REMBOURSEMENT / DETTES), the
          Devis sheet's Montant Total = Sous-total − Réduction − Remboursement. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-medium">Remboursement antérieur (crédit)</p>
          <p className="text-xs text-muted-foreground mb-2">
            Avoir reporté de l'année précédente (REMBOURCEMENT) — déduit du montant total.
          </p>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
            value={priorCredit}
            onChange={(e) => setPriorCredit(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            inputMode="numeric"
          />
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-medium">Dettes antérieures</p>
          <p className="text-xs text-muted-foreground mb-2">
            Solde dû reporté de l'année précédente (DETTES) — suivi séparément.
          </p>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
            value={priorDebt}
            onChange={(e) => setPriorDebt(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="rounded-md border border-border">
        <div className="border-b border-border px-3 py-2 bg-muted/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Détail par élève
          </p>
        </div>
        <ul className="divide-y divide-border">
          {billing.perStudent.map((s) => (
            <li key={s.index} className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{s.level}</span>
                </div>
                <span className="font-mono text-sm font-semibold">
                  {formatDzd(s.devis)}
                </span>
              </div>
              <div className="pl-3 text-xs text-muted-foreground space-y-1">
                {s.registrationFee > 0 && (
                  <div className="flex justify-between">
                    <span>Frais d'inscription (FI)</span>
                    <span className="font-mono">{formatDzd(s.registrationFee)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Scolarité annuelle</span>
                  <span className="font-mono">{formatDzd(s.tuition)}</span>
                </div>
                {s.remise > 0 && (
                  <div className="flex justify-between text-status-success">
                    <span>Remise négociée {s.paymentPlan === "full_annual" ? "" : "(déduite de V2)"}</span>
                    <span className="font-mono">−{formatDzd(s.remise)}</span>
                  </div>
                )}
                <div className="pl-3 text-[10px]">
                  {s.tranches.map((t) => (
                    <div key={t.label} className="flex justify-between">
                      <span>{t.label}</span>
                      <span className="font-mono">{formatDzd(t.amountDue)}</span>
                    </div>
                  ))}
                </div>
                {s.transport > 0 && (
                  <>
                    <div className="flex justify-between mt-1">
                      <span>
                        Transport
                        {s.transportDestinationLabel && (
                          <span className="text-[10px] text-muted"> — {s.transportDestinationLabel}</span>
                        )}
                        <span className="ml-1">(3 tranches)</span>
                      </span>
                      <span className="font-mono">{formatDzd(s.transport)}</span>
                    </div>
                    <div className="pl-3 text-[10px]">
                      {s.transportTranches.map((t) => (
                        <div key={t.label} className="flex justify-between">
                          <span>{t.label}</span>
                          <span className="font-mono">{formatDzd(t.amountDue)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-3 py-2 space-y-1 bg-muted/30">
          <div className="flex justify-between text-sm">
            <span>Sous-total</span>
            <span className="font-mono">{formatDzd(billing.subTotal)}</span>
          </div>
          {billing.priorCredit > 0 && (
            <div className="flex justify-between text-sm text-status-success">
              <span>Remboursement antérieur</span>
              <span className="font-mono">−{formatDzd(billing.priorCredit)}</span>
            </div>
          )}
          {billing.priorDebt > 0 && (
            <div className="flex justify-between text-sm text-status-danger">
              <span>Dettes antérieures (suivi séparé)</span>
              <span className="font-mono">{formatDzd(billing.priorDebt)}</span>
            </div>
          )}
          {billing.totalEarlyPaymentDiscount > 0 && (
            <div className="flex justify-between text-sm text-status-success">
              <span>Remise 5% paiement anticipé (avant le 30 juin, scolarité)</span>
              <span className="font-mono">−{formatDzd(billing.totalEarlyPaymentDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 border-t border-border">
            <span className="text-sm font-semibold">Montant total DZD</span>
            <span className="font-mono text-base font-bold text-primary">{formatDzd(billing.grandTotal)}</span>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Les tarifs proviennent de la matrice réelle 2026/2027 (classeur « Suivis clients »)
        et de la configuration administrateur (Paramètres → Tarification).
        Modifier un tarif ici n'affecte pas la configuration.
      </p>
    </div>
  );
}
