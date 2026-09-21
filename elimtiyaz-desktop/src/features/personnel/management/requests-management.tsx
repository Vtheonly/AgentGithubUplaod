// ============================================================================
// FILE: src/features/personnel/management/requests-management.tsx
// ============================================================================
/**
 * Workforce Requests & Reimbursement Center.
 *
 * WORKFLOW:
 *   - Worker submits a spending/reimbursement request with description, amount, and receipt note.
 *   - Admin reviews: Approve, Reject, or "Demander des précisions" (sends a question back to the worker).
 *   - Worker responds directly to the clarification inquiry.
 */

import { useState, useMemo } from "react";
import {
  Send,
  Plus,
  CheckCircle2,
  XCircle,
  MessageSquareReply,
  Receipt,
  Search,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Role } from "../../../core/rbac/roles";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
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
import { formatDzd } from "../../../core/format/currency";
import { formatDate } from "../../../core/format/date";
import {
  REQUEST_TYPE_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  type LeaveRequest,
  type RequestType,
} from "../../../domain/model/workforce";

const REQUEST_STATUS_TONE: Record<
  string,
  "neutral" | "warning" | "info" | "success" | "danger"
> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  clarification_requested: "info",
  cancelled: "neutral",
};

export function RequestsManagement() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const role = session?.role ?? Role.Worker;
  const canReviewRequests =
    role === Role.SuperAdmin ||
    role === Role.FinancialOfficer ||
    role === Role.Manager;
  const isGlobalReviewer =
    role === Role.SuperAdmin || role === Role.FinancialOfficer;
  const currentUserId = session?.userId ?? "";

  const me = useObservable(
    () => repos.personnel.observeByUserId(currentUserId),
    [currentUserId],
  );
  const myPersonnelId = me?.id ?? null;
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const teamPersonnelIds = useMemo(() => {
    if (role !== Role.Manager || !me) return new Set<string>();
    return new Set(
      personnel
        .filter(
          (member) =>
            member.id !== me.id &&
            (member.supervisorId === me.id ||
              member.departmentId === me.departmentId),
        )
        .map((member) => member.id),
    );
  }, [me, personnel, role]);

  const allRequests = useObservable(() => repos.leaveRequests.observe(), []);

  const displayedRequests = useMemo(() => {
    if (isGlobalReviewer) return allRequests;
    if (role === Role.Manager) {
      return allRequests.filter(
        (request) =>
          teamPersonnelIds.has(request.personnelId) ||
          request.personnelId === myPersonnelId,
      );
    }
    return myPersonnelId
      ? allRequests.filter((request) => request.personnelId === myPersonnelId)
      : [];
  }, [
    allRequests,
    isGlobalReviewer,
    role,
    teamPersonnelIds,
    myPersonnelId,
  ]);

  const [search, setSearch] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [reqType, setReqType] = useState<RequestType>("spending_reimbursement");
  const [reqAmount, setReqAmount] = useState<number>(3500);
  const [reqFromDate, setReqFromDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [reqToDate, setReqToDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [reqReason, setReqReason] = useState<string>("");

  // Admin decision & clarification modals
  const [clarifyTarget, setClarifyTarget] = useState<LeaveRequest | null>(null);
  const [clarifyQuestion, setClarifyQuestion] = useState("");

  const [respondTarget, setRespondTarget] = useState<LeaveRequest | null>(null);
  const [clarifyResponse, setClarifyResponse] = useState("");

  async function handleCreateRequest() {
    if (!reqReason.trim() || !session) return;
    if (!myPersonnelId) {
      toast.showError(
        "Demande indisponible",
        "Aucune fiche personnel n'est rattachée à votre compte — contactez l'administration.",
      );
      return;
    }
    const res = await repos.leaveRequests.submit({
      personnelId: myPersonnelId,
      personnelName: session.displayName ?? "Employé",
      type: reqType,
      fromDate: reqFromDate,
      toDate: reqToDate,
      amountRequested: reqType === "spending_reimbursement" ? reqAmount : null,
      reason: reqReason.trim(),
    });

    if (res.ok) {
      toast.showSuccess(
        "Demande transmise",
        "Votre demande a été soumise pour approbation.",
      );
      setCreateModalOpen(false);
      setReqReason("");
    } else {
      toast.showError("Échec de la demande", res.error.userMessage);
    }
  }

  async function handleDecideRequest(
    id: string,
    status: "approved" | "rejected",
  ) {
    if (!session) return;
    const res = await repos.leaveRequests.decide(
      id,
      status,
      session.userId,
      session.displayName ?? "Super Admin",
      status === "approved"
        ? "Approuvé par la direction."
        : "Demande non recevable.",
    );
    if (res.ok) {
      toast.showSuccess(
        status === "approved" ? "Demande approuvée" : "Demande refusée",
        "La décision a été notifiée à l'employé.",
      );
    } else {
      toast.showError("Décision refusée", res.error.userMessage);
    }
  }

  async function handleSendClarification() {
    if (!clarifyTarget || !clarifyQuestion.trim() || !session) return;
    const res = await repos.leaveRequests.requestClarification(
      clarifyTarget.id,
      clarifyQuestion.trim(),
      session.userId,
    );
    if (res.ok) {
      toast.showSuccess(
        "Précisions demandées",
        "Le collaborateur a été invité à fournir des détails supplémentaires.",
      );
      setClarifyTarget(null);
      setClarifyQuestion("");
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleRespondClarification() {
    if (!respondTarget || !clarifyResponse.trim()) return;
    const res = await repos.leaveRequests.respondClarification(
      respondTarget.id,
      clarifyResponse.trim(),
    );
    if (res.ok) {
      toast.showSuccess(
        "Précisions envoyées",
        "Votre réponse a été soumise à l'administration.",
      );
      setRespondTarget(null);
      setClarifyResponse("");
    } else {
      toast.showError("Échec de l'envoi", res.error.userMessage);
    }
  }

  const filtered = useMemo(() => {
    return displayedRequests.filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.personnelName.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        REQUEST_TYPE_LABELS_FR[r.type].toLowerCase().includes(q)
      );
    });
  }, [displayedRequests, search]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                {canReviewRequests
                  ? "Triage des Demandes & Remboursements de Dépenses"
                  : "Mes Demandes & Notes de Frais"}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Gestion des demandes de congés, autorisations d'absence et
                remboursements de dépenses professionnelles.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setCreateModalOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Nouvelle demande
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Aucune demande enregistrée.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border text-left">
                  <tr>
                    <th className="py-2.5 px-3">Demandeur</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Dates / Période</th>
                    <th className="py-2.5 px-3 text-right">Montant</th>
                    <th className="py-2.5 px-3">Statut</th>
                    <th className="py-2.5 px-3">Motif &amp; Précisions</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.map((req) => (
                    <tr
                      key={req.id}
                      className="hover:bg-accent/5 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-semibold text-foreground">
                        {req.personnelName}
                      </td>
                      <td className="py-2.5 px-3">
                        {REQUEST_TYPE_LABELS_FR[req.type]}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {formatDate(req.fromDate)}{" "}
                        {req.fromDate !== req.toDate &&
                          `→ ${formatDate(req.toDate)}`}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        {req.amountRequested
                          ? formatDzd(req.amountRequested)
                          : "—"}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusChip
                          label={REQUEST_STATUS_LABELS_FR[req.status]}
                          tone={REQUEST_STATUS_TONE[req.status]}
                        />
                      </td>
                      <td className="py-2.5 px-3 max-w-[280px]">
                        <p className="text-foreground">{req.reason}</p>
                        {req.clarificationRequest && (
                          <p className="text-[11px] text-status-warning font-medium mt-0.5">
                            Précision demandée : {req.clarificationRequest}
                          </p>
                        )}
                        {req.clarificationResponse && (
                          <p className="text-[11px] text-status-success font-medium mt-0.5">
                            Réponse : {req.clarificationResponse}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canReviewRequests && req.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-status-success hover:bg-status-success/10"
                                onClick={() =>
                                  handleDecideRequest(req.id, "approved")
                                }
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />{" "}
                                Approuver
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-status-warning hover:bg-status-warning/10"
                                onClick={() => {
                                  setClarifyTarget(req);
                                  setClarifyQuestion("");
                                }}
                                title="Demander des précisions"
                              >
                                <MessageSquareReply className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
                                onClick={() =>
                                  handleDecideRequest(req.id, "rejected")
                                }
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </>
                          )}

                          {!canReviewRequests &&
                            req.status === "clarification_requested" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setRespondTarget(req);
                                  setClarifyResponse("");
                                }}
                              >
                                Répondre
                              </Button>
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

      {/* Modal: New Request */}
      {createModalOpen && (
        <UnifiedModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
          title="Soumettre une demande"
          description="Votre demande sera transmise pour arbitrage administratif."
          submitLabel="Soumettre"
          onSubmit={handleCreateRequest}
          submitDisabled={!reqReason.trim()}
          size="md"
        >
          <div className="space-y-3">
            <FormField label="Type de demande" required>
              <Select
                value={reqType}
                onValueChange={(v) => setReqType(v as RequestType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spending_reimbursement">
                    Remboursement de frais / Dépense
                  </SelectItem>
                  <SelectItem value="leave">Congé annuel</SelectItem>
                  <SelectItem value="absence">Absence autorisée</SelectItem>
                  <SelectItem value="overtime">
                    Heures supplémentaires
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {reqType === "spending_reimbursement" && (
              <FormField label="Montant engagé (DZD)" required>
                <MoneyInput value={reqAmount} onChange={setReqAmount} />
              </FormField>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Date de début" required>
                <Input
                  type="date"
                  value={reqFromDate}
                  onChange={(e) => setReqFromDate(e.target.value)}
                />
              </FormField>
              <FormField label="Date de fin" required>
                <Input
                  type="date"
                  value={reqToDate}
                  onChange={(e) => setReqToDate(e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Motif et détails justificatifs" required>
              <Textarea
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                placeholder="Ex. Achat de fournitures pour l'atelier scientifique / Justificatif en pièce jointe..."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      {/* Modal: Admin requesting clarification */}
      {clarifyTarget && (
        <UnifiedModal
          open={!!clarifyTarget}
          onOpenChange={(o) => !o && setClarifyTarget(null)}
          title={`Demande de précisions — ${clarifyTarget.personnelName}`}
          description="Posez une question au collaborateur avant de statuer sur sa demande."
          submitLabel="Envoyer la question"
          onSubmit={handleSendClarification}
          submitDisabled={!clarifyQuestion.trim()}
          size="md"
        >
          <div className="space-y-3">
            <FormField label="Question / Précision requise" required>
              <Textarea
                value={clarifyQuestion}
                onChange={(e) => setClarifyQuestion(e.target.value)}
                placeholder="Ex. Veuillez joindre la facture acquittée du magasin pour procéder au remboursement."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      {/* Modal: Worker responding to clarification */}
      {respondTarget && (
        <UnifiedModal
          open={!!respondTarget}
          onOpenChange={(o) => !o && setRespondTarget(null)}
          title="Répondre à la demande de précisions"
          description={`Question de l'administration : « ${respondTarget.clarificationRequest} »`}
          submitLabel="Transmettre ma réponse"
          onSubmit={handleRespondClarification}
          submitDisabled={!clarifyResponse.trim()}
          size="md"
        >
          <div className="space-y-3">
            <FormField label="Votre réponse" required>
              <Textarea
                value={clarifyResponse}
                onChange={(e) => setClarifyResponse(e.target.value)}
                placeholder="Ex. Facture numérisée n° 78945 transmise ce matin par email au service comptabilité."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}
    </div>
  );
}
