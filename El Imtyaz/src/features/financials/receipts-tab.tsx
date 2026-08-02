/**
 * ReceiptsTab — replaces the previous ComingSoonCard.
 *
 * Iteration 3-B (plan §07.05): PDF receipts auto-generated on payment.
 *   - Recent Payment Receipt (single transaction, RCP-2026-XXXXX)
 *   - Full Account Statement (complete ledger per parent)
 *
 * No manual "Generate Receipt" button — every payment already triggers
 * repository.generateReceipt() on creation. This tab lets users
 * RE-DOWNLOAD the PDF for any past payment + export an account statement.
 *
 * Uses the shared PDF service (pdf-lib) so the visual language matches
 * every other generated document in the application.
 */
import { useState } from "react";
import { FileText, Download, Search, Loader2, FileBarChart, User } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { useToast } from "../../app/providers/toast-provider";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { EmptyState } from "../../shared/layout/state-views";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
} from "../../domain/model/payment";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatRelative, formatDate } from "../../core/format/date";
import {
  generatePaymentReceiptPdf,
  generateAccountStatementPdf,
  downloadPdf,
} from "../../infrastructure/receipt-pdf";
import type { Payment, Parent } from "../../domain/model";

export function ReceiptsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const payments = useObservable(() => repos.payments.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);

  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 220);
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [statementParentId, setStatementParentId] = useState<string>("");
  const [downloadingStatement, setDownloadingStatement] = useState(false);

  const filtered = payments.filter((p) => {
    if (methodFilter !== "all" && p.method !== methodFilter) return false;
    if (!debounced.trim()) return true;
    const q = debounced.toLowerCase();
    const parent = parents.find((par) => par.id === p.parentId);
    return (
      p.receiptNumber.toLowerCase().includes(q) ||
      (parent && `${parent.firstName} ${parent.lastName} ${parent.code}`.toLowerCase().includes(q))
    );
  });

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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Reçus de paiement
              </CardTitle>
              <CardDescription>
                {filtered.length} reçu(s) — cliquez sur une ligne pour télécharger le PDF.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Reçu, parent…"
                  className="pl-9 w-48"
                />
              </div>
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes méthodes</SelectItem>
                  <SelectItem value="cash">Espèces</SelectItem>
                  <SelectItem value="check">Chèque</SelectItem>
                  <SelectItem value="transfer">Virement</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState title="Aucun reçu" description="Aucun paiement ne correspond à votre recherche." />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.slice(0, 50).map((p) => {
                const parent = parents.find((par) => par.id === p.parentId);
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 p-3 hover:bg-accent/5 cursor-pointer"
                    onClick={() => downloadReceipt(p)}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-medium">{p.receiptNumber}</span>
                        <StatusChip
                          label={PAYMENT_STATUS_LABELS_FR[p.status]}
                          tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "neutral"}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {parent ? `${parent.firstName} ${parent.lastName}` : "—"}
                        <span>·</span>
                        <span>{PAYMENT_METHOD_LABELS_FR[p.method]}</span>
                        <span>·</span>
                        <span>{PAYMENT_CATEGORY_LABELS_FR[p.category]}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-semibold">{formatDzdPlain(p.amount)}</p>
                      <p className="text-[10px] text-muted-foreground">{formatRelative(p.collectedAt)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={downloadingId === p.id}
                      onClick={(e) => { e.stopPropagation(); downloadReceipt(p); }}
                      title="Télécharger le PDF"
                    >
                      {downloadingId === p.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">
        Plan §07.05 — les reçus sont générés automatiquement à l'encaissement.
        Ce tableau permet de re-télécharger un reçu à tout moment.
      </p>
    </div>
  );
}

// Re-export for type compatibility
void formatDate;
void Badge;
