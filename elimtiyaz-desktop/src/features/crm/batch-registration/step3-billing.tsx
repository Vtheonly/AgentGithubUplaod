/**
 * Step 3 — Billing config (reads from PricingConfig).
 *
 * Shows the registration-fee + transport toggles and a per-student breakdown
 * with the 3-tranche tuition split. Pure presentational component — state
 * and the `billing` useMemo live in the orchestrator.
 */
import { formatDzd } from "../../../core/format/currency";
import type { Billing } from "./types";

export function Step3({
  billing,
  includeRegistration,
  setIncludeRegistration,
  includeTransport,
  setIncludeTransport,
}: {
  billing: Billing;
  includeRegistration: boolean;
  setIncludeRegistration: (b: boolean) => void;
  includeTransport: boolean;
  setIncludeTransport: (b: boolean) => void;
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
            <p className="text-sm font-medium">Frais d'inscription</p>
            <p className="text-xs text-muted-foreground">Facturé une fois à l'inscription</p>
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
            <p className="text-xs text-muted-foreground">Basé sur la zone de résidence</p>
          </div>
          <span className="ml-auto font-mono text-sm">{formatDzd(billing.totalTransport)}</span>
        </label>
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
                  {formatDzd(s.tuition + s.transport)}
                </span>
              </div>
              <div className="pl-3 text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Scolarité (3 tranches)</span>
                  <span className="font-mono">{formatDzd(s.tuition)}</span>
                </div>
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
        <div className="border-t border-border px-3 py-2 bg-muted/30 flex justify-between">
          <span className="text-sm font-semibold">Total facturé</span>
          <span className="font-mono text-base font-bold text-primary">{formatDzd(billing.grandTotal)}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Les tarifs proviennent de la configuration administrateur (Paramètres → Tarification).
        Modifier un tarif ici n'affecte pas la configuration.
      </p>
    </div>
  );
}
