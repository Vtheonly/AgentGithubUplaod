/**
 * ReceiptsTab — re-downloadable payment receipts + account statement generator.
 *
 * Refactored to consume `<DataTable<Payment>>` for the receipts list (instead
 * of bespoke `<ul>/<li>` markup + hand-rolled search/filter state). The
 * account-statement generator stays as a small Card on top because it's a
 * form-style control, not a list.
 */
import { useState } from "react";
import { FileText, Download, Loader2, FileBarChart } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import {
  DataTable,
  type DataTableColumn,
  type DataTableAction,
} from "../../shared/ui/data-table";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  type Payment,
} from "../../domain/model/payment";
import { formatDzdPlain } from "../../core/format/currency";
import { formatRelative } from "../../core/format/date";
import {
  generatePaymentReceiptPdf,
  generateAccountStatementPdf,
  downloadPdf,
} from "../../infrastructure/receipt-pdf";
import type { Parent } from "../../domain/model";

const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  paid: "success",
  pending: "warning",
  overdue: "danger",
  refunded: "neutral",
  partial: "info",
};

export function ReceiptsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const payments = useObservable(() => repos.payments.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [statementParentId, setStatementParentId] = useState<string>("");
  const [downloadingStatement, setDownloadingStatement] = useState(false);

  async function downloadReceipt(payment: Payment) {
    setDownloadingId(payment.id);
    try {
      const parent = parents.find((p) => p.id === payment.parentId) ?? null;
      const bytes = await generatePaymentReceiptPdf(payment, parent);
      downloadPdf(bytes, `${payment.receiptNumber}.pdf`);
      toast.showSuccess("Reçu téléchargé", `${payment.receiptNumber}.pdf généré.`);
    } catch (e) {
      toast.showError("Échec", e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadStatement() {
    if (!statementParentId) {
      toast.showWarning("Sélection requise", "Choisissez un parent.");
      return;
    }
    setDownloadingStatement(true);
    try {
      const parent = parents.find((p) => p.id === statementParentId);
      if (!parent) throw new Error("Parent introuvable.");
      const parentPayments = payments.filter((p) => p.parentId === statementParentId);
      if (parentPayments.length === 0) {
        toast.showInfo("Aucun paiement", "Ce parent n'a aucun paiement à inclure.");
        return;
      }
      const bytes = await generateAccountStatementPdf(parentPayments, parent);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadPdf(bytes, `releve-${parent.code}-${stamp}.pdf`);
      toast.showSuccess("Relevé téléchargé", `${parentPayments.length} transactions incluses.`);
    } catch (e) {
      toast.showError("Échec", e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingStatement(false);
    }
  }

  const parentNameOf = (p: Payment): string => {
    const parent = parents.find((par) => par.id === p.parentId);
    return parent ? `${parent.firstName} ${parent.lastName}` : "—";
  };

  const columns: readonly DataTableColumn<Payment>[] = [
    {
      header: "Reçu",
      accessor: "receiptNumber",
      cell: (p) => <span className="font-mono font-medium">{p.receiptNumber}</span>,
    },
    {
      header: "Parent",
      accessor: (p) => parentNameOf(p),
      cell: (p) => parentNameOf(p),
    },
    {
      header: "Méthode",
      accessor: "method",
      cell: (p) => PAYMENT_METHOD_LABELS_FR[p.method],
    },
    {
      header: "Catégorie",
      accessor: "category",
      cell: (p) => PAYMENT_CATEGORY_LABELS_FR[p.category],
    },
    {
      header: "Montant",
      accessor: "amount",
      cell: (p) => <span className="font-mono font-semibold">{formatDzdPlain(p.amount)}</span>,
    },
    {
      header: "Date",
      accessor: "collectedAt",
      cell: (p) => formatRelative(p.collectedAt),
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (p) => (
        <StatusChip
          label={PAYMENT_STATUS_LABELS_FR[p.status]}
          tone={PAYMENT_STATUS_TONE[p.status] ?? "neutral"}
        />
      ),
    },
  ];

  const actions: readonly DataTableAction<Payment>[] = [
    {
      label: "PDF",
      variant: "outline",
      icon: <Download className="size-3.5" />,
      onClick: (p) => downloadReceipt(p),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Account statement generator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileBarChart className="h-4 w-4 text-primary" /> Relevé de compte complet
          </CardTitle>
          <CardDescription>
            Plan §07.05 — génère un PDF avec toutes les transactions d'un parent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground">Parent</label>
            <Select value={statementParentId} onValueChange={setStatementParentId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un parent…" />
              </SelectTrigger>
              <SelectContent>
                {parents.map((p: Parent) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} · {p.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={downloadStatement} disabled={downloadingStatement || !statementParentId}>
            {downloadingStatement ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Génération…</>
            ) : (
              <><Download className="h-4 w-4" /> Télécharger le relevé</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Receipts list */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Reçus de paiement
          </CardTitle>
          <CardDescription>
            Cliquez sur une ligne ou sur l'action PDF pour télécharger le reçu.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <DataTable<Payment>
            data={payments}
            columns={columns}
            actions={actions}
            searchFields={["receiptNumber"]}
            searchPlaceholder="Rechercher un numéro de reçu…"
            pageSize={15}
            onRowClick={(p) => downloadReceipt(p)}
          />
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">
        Plan §07.05 — les reçus sont générés automatiquement à l'encaissement.
        Ce tableau permet de re-télécharger un reçu à tout moment.
      </p>

      {/* Loading indicator while a PDF is being generated (subtle visual hint) */}
      {downloadingId && (
        <div className="fixed bottom-4 right-4 rounded-md border border-border bg-popover px-4 py-2 text-xs text-muted-foreground shadow-lg">
          <Loader2 className="inline size-3.5 mr-1.5 animate-spin" />
          Génération du PDF…
        </div>
      )}
    </div>
  );
}
