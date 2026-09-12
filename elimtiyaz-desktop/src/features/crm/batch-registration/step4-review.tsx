/**
 * Step 4 — Review + atomic submit summary.
 *
 * Renders the atomic-transaction banner + parent / students / billing
 * recap. Pure presentational component — submit lives in the orchestrator.
 */
import { Badge } from "../../../shared/ui/badge";
import { LEVEL_LABELS_FR } from "../../../domain/model/student";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../domain/model/parent";
import { formatDzd } from "../../../core/format/currency";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import type { Step1Parent, Step2Student, Billing } from "./types";

export function Step4({
  parent,
  students,
  billing,
}: {
  parent: Step1Parent;
  students: Step2Student[];
  billing: Billing;
}) {
  const repos = useRepositories();
  // vault §04.03 — review shows the assigned class alongside the level.
  const classes = useObservable(() => repos.classes.observe(), []);
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-status-success/40 bg-status-success/5 p-3">
        <p className="text-sm font-medium text-status-success">Transaction atomique</p>
        <p className="text-xs text-muted-foreground mt-1">
          Tout sera créé en une seule opération (BEGIN…COMMIT). Si une étape échoue, tout est annulé.
        </p>
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Parent</p>
        <p className="text-sm font-medium">
          {parent.firstName} {parent.lastName}
        </p>
        <p className="text-xs text-muted-foreground">{parent.phone}</p>
        {parent.email && <p className="text-xs text-muted-foreground">{parent.email}</p>}
        {parent.transportDestination && (
          <Badge variant="outline">
            {TRANSPORT_DESTINATION_LABELS_FR[parent.transportDestination]}
          </Badge>
        )}
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Élèves ({students.length})
        </p>
        <ul className="space-y-1.5">
          {students.map((s, i) => {
            const klass = classes.find((c) => c.id === s.classId) ?? null;
            return (
              <li key={i} className="flex items-center justify-between text-sm">
                <span>
                  {s.firstName}
                  {s.middleName ? ` ${s.middleName}` : ""} {s.lastName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {LEVEL_LABELS_FR[s.level]} · Année {s.gradeYear}
                  {klass ? ` · ${klass.name}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Facturation</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Frais d'inscription (par élève)</span>
            <span className="font-mono">{formatDzd(billing.registrationFee)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Scolarité ({students.length} élève(s))</span>
            <span className="font-mono">{formatDzd(billing.totalTuition)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Transport</span>
            <span className="font-mono">{formatDzd(billing.totalTransport)}</span>
          </div>
          {billing.totalRemise > 0 && (
            <div className="flex justify-between text-status-success">
              <span className="text-muted-foreground">Remises négociées</span>
              <span className="font-mono">−{formatDzd(billing.totalRemise)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sous-total</span>
            <span className="font-mono">{formatDzd(billing.subTotal)}</span>
          </div>
          {billing.priorCredit > 0 && (
            <div className="flex justify-between text-status-success">
              <span className="text-muted-foreground">Remboursement antérieur</span>
              <span className="font-mono">−{formatDzd(billing.priorCredit)}</span>
            </div>
          )}
          {billing.priorDebt > 0 && (
            <div className="flex justify-between text-status-danger">
              <span className="text-muted-foreground">Dettes antérieures (suivi séparé)</span>
              <span className="font-mono">{formatDzd(billing.priorDebt)}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t border-border">
            <span className="font-semibold">Montant total DZD</span>
            <span className="font-mono font-bold text-primary">{formatDzd(billing.grandTotal)}</span>
          </div>
          {billing.totalEarlyPaymentDiscount > 0 && (
            <div className="flex justify-between text-xs text-status-success">
              <span className="text-muted-foreground">
                dont remise 5% paiement anticipé (avant le 30 juin, scolarité)
              </span>
              <span className="font-mono">−{formatDzd(billing.totalEarlyPaymentDiscount)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
