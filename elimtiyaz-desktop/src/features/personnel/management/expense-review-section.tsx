// ============================================================================
// FILE: src/features/personnel/management/expense-review-section.tsx
// ============================================================================
/**
 * T-521 (issue #29 / WORKFORCE-517) — the Staff/Personnel expense surface.
 *
 * THE ROOT CAUSE THIS CLOSES: the Personnel section's "Demandes & Dépenses"
 * tab rendered ONLY leave requests — an expense created in Finance (the
 * owner's `ddd` case) had NO rendering path anywhere in Personnel. This
 * section is that missing surface, reading the SAME canonical
 * `repos.expenses` observable the Finance tab reads: one record store, two
 * mounted interfaces (the issue's final requirement — "one expense-management
 * system with multiple interfaces, not separate implementations").
 *
 * What each audience sees:
 *   - REVIEWERS (super_admin / financial_officer / manager — the 0019
 *     expense_tickets_select visibility set): the pending-approval queue
 *     with quick approve/reject, the responsible-missing flag, and the full
 *     inspection drawer (description, amount, category, responsible person,
 *     supporting images, timeline) — the issue's §5 review interface.
 *   - EVERY STAFF MEMBER: "Mes dépenses" — the tickets they submitted OR are
 *     responsible for, with live status.
 *
 * Every mutation goes through the SAME repository the Finance drawer uses —
 * approve/reject here is the identical canonical write (no parallel logic).
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Paperclip,
  Plus,
  Receipt,
  Search,
  XCircle,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Role } from "../../../core/rbac/roles";
import { Permission } from "../../../core/rbac/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { StatusChip } from "../../../shared/ui/status-chip";
import { formatDzd } from "../../../core/format/currency";
import { formatDateTime } from "../../../core/format/date";
import {
  EXPENSE_STATUS_LABELS_FR,
  EXPENSE_CATEGORY_LABELS_FR,
  EXPENSE_URGENCY_LABELS_FR,
  type Expense,
} from "../../../domain/model/expense";
// ONE detail drawer, TWO surfaces (Finance + Personnel) — the same component,
// the same data path, the same workflow actions.
import { ExpenseDetailDrawer } from "../../financials/expense-detail-drawer";
import { ExpenseSubmitModal } from "../../financials/expense-submit-modal";

const EXPENSE_STATUS_TONE: Record<
  string,
  "neutral" | "warning" | "info" | "success" | "danger"
> = {
  draft: "neutral",
  submitted: "warning",
  approved: "info",
  rejected: "danger",
  disbursed: "info",
  settled: "success",
};

export function ExpenseReviewSection() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const role = session?.role ?? Role.Worker;
  const currentUserId = session?.userId ?? "";
  const isReviewer =
    role === Role.SuperAdmin ||
    role === Role.FinancialOfficer ||
    role === Role.Manager;

  // THE canonical stream — the SAME observable the Finance tab reads.
  const expenses = useObservable(() => repos.expenses.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const [search, setSearch] = useState("");
  const [drawerExpenseId, setDrawerExpenseId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const canApprove = !!session && session.permissions.has(Permission.ApproveExpense);

  const pendingQueue = useMemo(
    () =>
      expenses
        .filter((e) => e.status === "submitted")
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)),
    [expenses],
  );

  const myExpenses = useMemo(
    () =>
      expenses
        .filter(
          (e) => e.submittedBy === currentUserId || e.responsibleProfileId === currentUserId,
        )
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)),
    [expenses, currentUserId],
  );

  const missingResponsible = useMemo(
    () => pendingQueue.filter((e) => !e.responsibleProfileId).length,
    [pendingQueue],
  );

  function personName(profileId: string | null): string {
    if (!profileId) return "—";
    const p = personnel.find((x) => x.userId === profileId);
    return p ? `${p.firstName} ${p.lastName}` : "Membre du personnel";
  }

  function matchesSearch(e: Expense): boolean {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.title.toLowerCase().includes(q) ||
      e.requestCode.toLowerCase().includes(q) ||
      e.payee.toLowerCase().includes(q) ||
      personName(e.responsibleProfileId).toLowerCase().includes(q)
    );
  }

  async function handleQuickApprove(e: Expense) {
    if (!session) return;
    if (e.submittedBy === session.userId) {
      toast.showWarning(
        "Auto-approbation interdite",
        "Le demandeur ne peut pas approuver sa propre dépense (règle du plan §08).",
      );
      return;
    }
    const r = await repos.expenses.approve(e.id, session.userId, "Approuvé");
    if (r.ok) toast.showSuccess("Dépense approuvée", `${e.requestCode} — le demandeur a été notifié.`);
    else toast.showError("Échec de l'approbation", r.error.userMessage);
  }

  function openReject(e: Expense) {
    // The reject flow needs the mandatory reason — the drawer's modal is the
    // canonical path (one implementation, two entry points).
    setDrawerExpenseId(e.id);
  }

  return (
    <div className="space-y-4">
      {/* ── The reviewer's approval queue (the issue's §5) ─────────────── */}
      {isReviewer && (
        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-primary" />
                  Dépenses à valider ({pendingQueue.length})
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Les demandes de dépenses soumises par le personnel — les mêmes
                  enregistrements que la section Finances.
                  {missingResponsible > 0 && (
                    <span className="text-status-warning font-medium">
                      {" "}
                      · {missingResponsible} sans responsable renseigné
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher…"
                    className="pl-8 h-8 w-52 text-xs"
                  />
                </div>
                <Button size="sm" onClick={() => setSubmitOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Nouvelle dépense
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {pendingQueue.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                Aucune dépense en attente — toutes les demandes ont été traitées.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground border-b border-border text-left">
                    <tr>
                      <th className="py-2.5 px-3">Réf.</th>
                      <th className="py-2.5 px-3">Intitulé</th>
                      <th className="py-2.5 px-3">Catégorie</th>
                      <th className="py-2.5 px-3">Bénéficiaire</th>
                      <th className="py-2.5 px-3">Responsable</th>
                      <th className="py-2.5 px-3 text-right">Montant</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {pendingQueue.filter(matchesSearch).map((e) => (
                      <tr key={e.id} className="hover:bg-accent/5 transition-colors">
                        <td className="py-2.5 px-3 font-mono">{e.requestCode}</td>
                        <td className="py-2.5 px-3 font-semibold">
                          <button
                            type="button"
                            className="hover:underline text-left"
                            onClick={() => setDrawerExpenseId(e.id)}
                            title="Ouvrir le détail complet (description, justificatifs, décisions)"
                          >
                            {e.title}
                          </button>
                          <div className="text-[10px] text-muted-foreground font-normal">
                            Soumise le {formatDateTime(e.submittedAt)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {EXPENSE_CATEGORY_LABELS_FR[e.category]}
                          <div className="text-[10px] text-muted-foreground">
                            Urgence {EXPENSE_URGENCY_LABELS_FR[e.urgency]}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">{e.payee}</td>
                        <td className="py-2.5 px-3">
                          {e.responsibleProfileId ? (
                            personName(e.responsibleProfileId)
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-status-warning font-medium"
                              title="Aucun responsable renseigné — à compléter"
                            >
                              <AlertTriangle className="h-3 w-3" /> À renseigner
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          {formatDzd(e.amount)}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusChip
                            label={EXPENSE_STATUS_LABELS_FR[e.status]}
                            tone={EXPENSE_STATUS_TONE[e.status] ?? "neutral"}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDrawerExpenseId(e.id)}
                              title="Examiner la demande et ses justificatifs"
                            >
                              <Paperclip className="h-3.5 w-3.5" /> Examiner
                            </Button>
                            {canApprove && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => void handleQuickApprove(e)}
                                  disabled={e.submittedBy === currentUserId}
                                  title={
                                    e.submittedBy === currentUserId
                                      ? "Auto-approbation interdite (plan §08)"
                                      : "Approuver la dépense"
                                  }
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Approuver
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => openReject(e)}
                                  disabled={e.submittedBy === currentUserId}
                                  title={
                                    e.submittedBy === currentUserId
                                      ? "Auto-approbation interdite (plan §08)"
                                      : "Rejeter (motif obligatoire)"
                                  }
                                >
                                  <XCircle className="h-3.5 w-3.5" /> Rejeter
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── "Mes dépenses" — every staff member's own + responsible tickets */}
      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                Mes dépenses ({myExpenses.length})
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Les dépenses que vous avez soumises ou dont vous êtes responsable —
                visibles également dans la section Finances.
              </CardDescription>
            </div>
            {!isReviewer && (
              <Button size="sm" onClick={() => setSubmitOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Nouvelle dépense
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {myExpenses.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              Aucune dépense à ce jour — soumettez votre première demande de
              dépense avec ses justificatifs.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border text-left">
                  <tr>
                    <th className="py-2.5 px-3">Réf.</th>
                    <th className="py-2.5 px-3">Intitulé</th>
                    <th className="py-2.5 px-3">Catégorie</th>
                    <th className="py-2.5 px-3 text-right">Montant</th>
                    <th className="py-2.5 px-3">Statut</th>
                    <th className="py-2.5 px-3">Décision</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {myExpenses.map((e) => (
                    <tr key={e.id} className="hover:bg-accent/5 transition-colors">
                      <td className="py-2.5 px-3 font-mono">{e.requestCode}</td>
                      <td className="py-2.5 px-3 font-semibold">
                        <button
                          type="button"
                          className="hover:underline text-left"
                          onClick={() => setDrawerExpenseId(e.id)}
                        >
                          {e.title}
                        </button>
                        <div className="text-[10px] text-muted-foreground font-normal">
                          {formatDateTime(e.submittedAt)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">{EXPENSE_CATEGORY_LABELS_FR[e.category]}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        {formatDzd(e.amount)}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusChip
                          label={EXPENSE_STATUS_LABELS_FR[e.status]}
                          tone={EXPENSE_STATUS_TONE[e.status] ?? "neutral"}
                        />
                      </td>
                      <td className="py-2.5 px-3 max-w-[220px] text-muted-foreground">
                        {e.status === "rejected" && e.approvalNote
                          ? `Rejetée : ${e.approvalNote}`
                          : e.approvalNote ?? "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setDrawerExpenseId(e.id)}>
                          Détails
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ONE drawer, both surfaces — the full inspection + decision surface. */}
      <ExpenseDetailDrawer
        expenseId={drawerExpenseId}
        open={drawerExpenseId !== null}
        onOpenChange={(o) => !o && setDrawerExpenseId(null)}
      />
      {/* ONE submit form, both surfaces. */}
      <ExpenseSubmitModal
        open={submitOpen}
        onOpenChange={setSubmitOpen}
      />
    </div>
  );
}
