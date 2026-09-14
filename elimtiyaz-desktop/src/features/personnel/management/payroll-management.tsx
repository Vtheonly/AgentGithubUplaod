// ============================================================================
// FILE: src/features/personnel/management/payroll-management.tsx
// ============================================================================
/**
 * Payroll, Salary & Compensation Management Center.
 *
 * BUSINESS RULES & AUDIT REQUIREMENTS:
 *   1. Every employee has a base salary and an assigned payment method.
 *   2. The Super Admin tracks who has been paid and who has not for each period.
 *   3. When adjusting a salary (raise, cut, bonus, deduction), a NON-EMPTY
 *      justification/reason is MANDATORY and permanently recorded.
 *   4. An immutable audit trail captures amountBefore, amountAfter, delta, and actor.
 */

import { useState, useMemo } from "react";
import {
  Wallet,
  CheckCircle2,
  AlertTriangle,
  History,
  TrendingUp,
  TrendingDown,
  Download,
  Plus,
  Search,
  Receipt,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Role } from "../../../core/rbac/roles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import { Badge } from "../../../shared/ui/badge";
import { StatusChip } from "../../../shared/ui/status-chip";
import { FormField } from "../../../shared/ui/form-field";
import { MoneyInput } from "../../../shared/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { formatDzd, formatDzdPlain } from "../../../core/format/currency";
import { formatDate } from "../../../core/format/date";
import {
  SALARY_ADJUSTMENT_TYPE_LABELS_FR,
  PAYROLL_METHOD_LABELS_FR,
  STAFF_CATEGORY_LABELS_FR,
  type Personnel,
  type SalaryAdjustmentType,
  type PayrollMethod,
} from "../../../domain/model/personnel";
import { generatePayslipPdf, downloadPdf } from "../../../infrastructure/receipt-pdf";

export function PayrollManagement() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const isSuperAdmin = session?.role === Role.SuperAdmin || session?.role === Role.FinancialOfficer;
  const currentUserId = session?.userId ?? "";

  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);

  const me = useObservable(
    () => repos.personnel.observeByUserId(currentUserId),
    [currentUserId],
  );

  const [period, setPeriod] = useState<string>("2026-03");
  const [search, setSearch] = useState("");

  // Modals
  const [adjustModalWorker, setAdjustModalWorker] = useState<Personnel | null>(null);
  const [adjustType, setAdjustType] = useState<SalaryAdjustmentType>("raise");
  const [adjustAmount, setAdjustAmount] = useState<number>(5000);
  const [adjustReason, setAdjustReason] = useState<string>("");

  const [payModalWorker, setPayModalWorker] = useState<Personnel | null>(null);
  const [payMethod, setPayMethod] = useState<PayrollMethod>("bank_transfer");
  const [payRefNumber, setPayRefNumber] = useState<string>("");

  const [historyModalWorker, setHistoryModalWorker] = useState<Personnel | null>(null);
  const [downloading, setDownloading] = useState(false);

  // T-369: the payroll ledger is the REACTIVE repository stream — the paid/
  // unpaid statuses per period come from the canonical salary_payments rows
  // (mock store in mock mode; the 0095 table + record_salary_disbursement
  // RPC in Supabase mode). The pre-T-369 local `useState<Set<string>>` was a
  // client-side simulation that never persisted (WORKFORCE-500 evidence 2).
  const salaryPayments = useObservable(() => repos.personnel.observeSalaryPayments(), []);
  const paidWorkerIds = useMemo(
    () =>
      new Set(
        salaryPayments
          .filter((p) => p.period === period && p.status === "paid")
          .map((p) => p.personnelId),
      ),
    [salaryPayments, period],
  );
  const totalPaidAmount = useMemo(
    () =>
      salaryPayments
        .filter((p) => p.period === period && p.status === "paid")
        .reduce((sum, p) => sum + p.netPaid, 0),
    [salaryPayments, period],
  );

  const activeStaff = useMemo(
    () => allPersonnel.filter((p) => p.status === "active"),
    [allPersonnel],
  );

  const totalPayrollBudget = useMemo(
    () => activeStaff.reduce((sum, p) => sum + (p.salary ?? 0), 0),
    [activeStaff],
  );

  const totalUnpaidAmount = Math.max(0, totalPayrollBudget - totalPaidAmount);

  const filteredStaff = useMemo(() => {
    return activeStaff.filter((p) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
        p.position.toLowerCase().includes(q) ||
        p.phone.includes(q)
      );
    });
  }, [activeStaff, search]);

  // Actions
  async function handleConfirmSalaryAdjustment() {
    if (!adjustModalWorker || !adjustReason.trim() || !session) {
      toast.showWarning("Justification obligatoire", "Un motif formel est requis pour toute modification de rémunération.");
      return;
    }

    // T-369: the adjustment goes through the canonical repository path —
    // `adjust_personnel_salary` (Supabase mode: the atomic, role-guarded,
    // audit-logged RPC; the server computes the next base, floors cuts at 0,
    // and writes the immutable salary_adjustments row + the master audit
    // entry). The pre-T-369 client-side computation + embedded-array write
    // is the WORKFORCE-500 defect being fixed here.
    const res = await repos.personnel.adjustSalary({
      personnelId: adjustModalWorker.id,
      type: adjustType,
      amount: adjustAmount,
      reason: adjustReason.trim(),
      actorId: session.userId,
      actorName: session.displayName ?? "Super Admin",
    });

    if (res.ok) {
      toast.showSuccess(
        "Rémunération ajustée",
        `${SALARY_ADJUSTMENT_TYPE_LABELS_FR[res.value.type]} enregistrée (${res.value.delta > 0 ? "+" : ""}${formatDzdPlain(res.value.delta)} DA). Motif tracé dans l'audit.`,
      );
      setAdjustModalWorker(null);
      setAdjustReason("");
    } else {
      toast.showError("Ajustement refusé", res.error.userMessage);
    }
  }

  async function handleRecordDisbursement() {
    if (!payModalWorker || !session) return;
    // T-369: through the canonical `record_salary_disbursement` path —
    // persisted (idempotent per person+period), with the period's one-off
    // bonuses/deductions netted server-side.
    const res = await repos.personnel.recordSalaryPayment({
      personnelId: payModalWorker.id,
      period,
      method: payMethod,
      referenceNumber: payRefNumber || null,
      actorId: session.userId,
      actorName: session.displayName ?? "Super Admin",
    });

    if (res.ok) {
      toast.showSuccess(
        "Salaire marqué comme payé",
        `Versement de ${formatDzdPlain(res.value.netPaid)} DA enregistré pour ${payModalWorker.firstName} ${payModalWorker.lastName} (${period}).`,
      );
      setPayModalWorker(null);
      setPayRefNumber("");
    } else {
      toast.showError("Versement refusé", res.error.userMessage);
    }
  }

  async function handleDownloadWorkerPayslip(p: Personnel) {
    setDownloading(true);
    try {
      const pdfBytes = await generatePayslipPdf(p);
      const fileName = `fiche-paie-${p.firstName}-${p.lastName}-${period}.pdf`;
      downloadPdf(pdfBytes, fileName);
      toast.showSuccess("Fiche de paie téléchargée", fileName);
    } catch (e) {
      toast.showError("Échec", String(e));
    } finally {
      setDownloading(false);
    }
  }

  // Worker view
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              Ma Rémunération & Bulletins de Paie
            </CardTitle>
            <CardDescription>
              Consultez vos détails de rémunération et téléchargez vos fiches de paie officielles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 p-4 rounded-lg border bg-surface-panel">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Salaire de base mensuel</p>
                <p className="text-2xl font-mono font-bold text-foreground mt-1">
                  {me?.salary ? formatDzd(me.salary) : "Non renseigné"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Mode de règlement</p>
                <p className="text-sm font-semibold text-foreground mt-1">
                  {me?.paymentMethod ? PAYROLL_METHOD_LABELS_FR[me.paymentMethod] : "Virement bancaire"}
                </p>
                <p className="text-xs font-mono text-muted-foreground">{me?.bankAccount || "RIB : Non spécifié"}</p>
              </div>
            </div>

            {me && (
              <Button
                onClick={() => handleDownloadWorkerPayslip(me)}
                disabled={downloading}
                className="w-full sm:w-auto"
              >
                <Download className="h-4 w-4 mr-2" />
                Télécharger ma fiche de paie du mois ({period})
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Super Admin Control Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-3.5 bg-surface-panel border-border">
          <span className="text-xs uppercase text-muted-foreground font-semibold">Masse Salariale ({period})</span>
          <div className="text-2xl font-mono font-bold text-foreground mt-1">
            {formatDzd(totalPayrollBudget, { compact: true })}
          </div>
          <span className="text-[10px] text-muted-foreground">{activeStaff.length} employés actifs</span>
        </Card>

        <Card className="p-3.5 bg-status-success/5 border-status-success/30">
          <span className="text-xs uppercase text-status-success font-semibold">Salaires Versés</span>
          <div className="text-2xl font-mono font-bold text-status-success mt-1">
            {formatDzd(totalPaidAmount, { compact: true })}
          </div>
          <span className="text-[10px] text-muted-foreground">{paidWorkerIds.size} sur {activeStaff.length} payés</span>
        </Card>

        <Card className="p-3.5 bg-status-warning/5 border-status-warning/30">
          <span className="text-xs uppercase text-status-warning font-semibold">Restant à Verser</span>
          <div className="text-2xl font-mono font-bold text-status-warning mt-1">
            {formatDzd(totalUnpaidAmount, { compact: true })}
          </div>
          <span className="text-[10px] text-muted-foreground">{activeStaff.length - paidWorkerIds.size} en attente</span>
        </Card>
      </div>

      {/* Main Staff Payroll Ledger */}
      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                Registre des Rémunérations &amp; Historique d'Ajustements
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Suivi des versements, modifications de salaires avec justification obligatoire, et téléchargement des fiches de paie.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-8 w-36 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2026-03">Mars 2026</SelectItem>
                  <SelectItem value="2026-02">Février 2026</SelectItem>
                  <SelectItem value="2026-01">Janvier 2026</SelectItem>
                  <SelectItem value="2025-12">Décembre 2025</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher par employé..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground border-b border-border text-left">
                <tr>
                  <th className="py-2.5 px-3">Collaborateur</th>
                  <th className="py-2.5 px-3">Poste &amp; Dépt</th>
                  <th className="py-2.5 px-3 text-right">Salaire Mensuel</th>
                  <th className="py-2.5 px-3">Mode de Paiement</th>
                  <th className="py-2.5 px-3 text-center">Statut ({period})</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredStaff.map((p) => {
                  const isPaid = paidWorkerIds.has(p.id);
                  const dept = departments.find((d) => d.id === p.departmentId);
                  const adjustmentsCount = p.salaryAdjustments?.length ?? 0;

                  return (
                    <tr key={p.id} className="hover:bg-accent/5 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-foreground">
                        {p.firstName} {p.lastName}
                        <span className="block text-[10px] text-muted-foreground font-mono">{p.phone}</span>
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="font-medium text-foreground">{p.position || "—"}</span>
                        <span className="block text-[10px] text-muted-foreground">{dept?.name ?? STAFF_CATEGORY_LABELS_FR[p.staffCategory]}</span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-sm">
                        {p.salary ? formatDzdPlain(p.salary) + " DA" : "—"}
                        {adjustmentsCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setHistoryModalWorker(p)}
                            className="block text-[10px] text-primary hover:underline ml-auto font-sans font-normal"
                          >
                            {adjustmentsCount} modif(s)
                          </button>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-muted-foreground">
                        {p.paymentMethod ? PAYROLL_METHOD_LABELS_FR[p.paymentMethod] : "Espèces"}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <StatusChip
                          label={isPaid ? "Payé" : "En attente"}
                          tone={isPaid ? "success" : "warning"}
                        />
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isPaid && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-status-success hover:bg-status-success/10 font-semibold"
                              onClick={() => {
                                setPayModalWorker(p);
                                setPayMethod(p.paymentMethod ?? "bank_transfer");
                              }}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Marquer Payé
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-primary"
                            onClick={() => {
                              setAdjustModalWorker(p);
                              setAdjustType("raise");
                              setAdjustAmount(5000);
                              setAdjustReason("");
                            }}
                          >
                            <TrendingUp className="h-3 w-3 mr-1" /> Ajuster
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => handleDownloadWorkerPayslip(p)}
                            title="Fiche de paie"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal 1: Salary Adjustment with MANDATORY Justification */}
      {adjustModalWorker && (
        <UnifiedModal
          open={!!adjustModalWorker}
          onOpenChange={(o) => !o && setAdjustModalWorker(null)}
          title={`Ajustement de rémunération — ${adjustModalWorker.firstName} ${adjustModalWorker.lastName}`}
          description={`Salaire actuel : ${formatDzd(adjustModalWorker.salary ?? 0)}. Tout changement sera tracé dans le journal d'audit avec votre identité.`}
          submitLabel="Valider l'ajustement"
          onSubmit={handleConfirmSalaryAdjustment}
          submitDisabled={!adjustReason.trim() || adjustAmount <= 0}
          size="md"
        >
          <div className="space-y-4">
            <FormField label="Type d'ajustement" required>
              <Select value={adjustType} onValueChange={(v) => setAdjustType(v as SalaryAdjustmentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raise">Augmentation permanente (+)</SelectItem>
                  <SelectItem value="cut">Réduction permanente (-)</SelectItem>
                  <SelectItem value="bonus">Prime ponctuelle (+)</SelectItem>
                  <SelectItem value="deduction">Retenue ponctuelle (-)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Montant de la modification (DZD)" required>
              <MoneyInput value={adjustAmount} onChange={setAdjustAmount} />
            </FormField>

            <FormField
              label="Motif / Justification formelle de la modification"
              required
              hint="Obligatoire — expliquez clairement la raison (ex. Récompense de performance, revalorisation grille 2026, pénalité de retard...)"
            >
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Indiquez le motif précis de l'augmentation ou de la réduction..."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      {/* Modal 2: Record Payment */}
      {payModalWorker && (
        <UnifiedModal
          open={!!payModalWorker}
          onOpenChange={(o) => !o && setPayModalWorker(null)}
          title={`Enregistrer le versement du salaire — ${payModalWorker.firstName} ${payModalWorker.lastName}`}
          description={`Période : ${period} · Montant net : ${formatDzd(payModalWorker.salary ?? 0)}`}
          submitLabel="Confirmer le versement"
          onSubmit={handleRecordDisbursement}
          size="sm"
        >
          <div className="space-y-3">
            <FormField label="Méthode de versement" required>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PayrollMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Virement bancaire</SelectItem>
                  <SelectItem value="cash">Espèces</SelectItem>
                  <SelectItem value="check">Chèque</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Référence bancaire / N° de pièce (optionnel)">
              <Input
                value={payRefNumber}
                onChange={(e) => setPayRefNumber(e.target.value)}
                placeholder="Ex. VIR-2026-03-014"
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      {/* Modal 3: History of Adjustments */}
      {historyModalWorker && (
        <UnifiedModal
          open={!!historyModalWorker}
          onOpenChange={(o) => !o && setHistoryModalWorker(null)}
          title={`Historique des modifications de salaire — ${historyModalWorker.firstName} ${historyModalWorker.lastName}`}
          description="Traçabilité complète des augmentations, retenues et primes avec leurs motifs."
          hideSubmit
          cancelLabel="Fermer"
          size="md"
        >
          <div className="space-y-3">
            {(historyModalWorker.salaryAdjustments ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Aucun ajustement antérieur.</p>
            ) : (
              <ul className="divide-y divide-border/50 text-xs">
                {historyModalWorker.salaryAdjustments?.map((adj) => (
                  <li key={adj.id} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        {adj.delta > 0 ? (
                          <TrendingUp className="h-3.5 w-3.5 text-status-success" />
                        ) : (
                          <TrendingDown className="h-3.5 w-3.5 text-status-danger" />
                        )}
                        {SALARY_ADJUSTMENT_TYPE_LABELS_FR[adj.type]}
                      </span>
                      <span className="font-mono font-bold text-foreground">
                        {adj.delta > 0 ? `+${formatDzdPlain(adj.delta)}` : formatDzdPlain(adj.delta)} DA
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      <strong>Motif :</strong> {adj.reason}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Approuvé par {adj.approvedByName} le {formatDate(adj.effectiveDate)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </UnifiedModal>
      )}
    </div>
  );
}