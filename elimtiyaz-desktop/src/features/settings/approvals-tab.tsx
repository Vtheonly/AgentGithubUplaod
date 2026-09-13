// ============================================================================
// FILE: elimtiyaz-desktop/src/features/settings/approvals-tab.tsx
// ============================================================================
/**
 * ApprovalsTab — admin UI for the web-registration → admin-approval workflow.
 *
 * This tab is shown to SuperAdmin + SupportStaff. It displays:
 *   1. Pending approval requests (web visitors who signed up via Google OAuth
 *      or email/password on the Web Portal)
 *   2. For each request: the user's email, requested role, activation code,
 *      national ID, phone, full name, notes
 *   3. The matched parent profile (if any) — found via activation_code,
 *      email, national_id, or phone lookup
 *   4. Approve / Reject buttons:
 *      - "Approuver & Lier" — manually search/select an existing parent to bind to
 *      - "Approuver & Créer" — opens a form to create a brand new parent
 *      - "Rejeter" — opens a modal requiring a rejection reason
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Role } from "../../core/rbac/roles";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Textarea } from "../../shared/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../shared/ui/select";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { EmptyState, LoadingState } from "../../shared/layout/state-views";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import {
  UserCheck,
  UserX,
  Clock,
  Mail,
  Phone,
  IdCard,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Search,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import type { RepositoriesWithApprovals } from "../../infrastructure/supabase/supabase-repositories";
import type { PendingApprovalWithDetails } from "../../infrastructure/supabase/repositories/supabase-approval-repository";
import { parentDisplayName, type Parent } from "../../domain/model/parent";

interface ApprovalDecision {
  requestId: string;
  type: "approve_existing" | "approve_new" | "reject";
  targetParentId?: string | null;
  newParent?: {
    first_name: string;
    last_name: string;
    primary_phone: string;
    email?: string;
    national_id?: string;
    address?: string;
    city?: string;
    relationship?: string;
  };
  reason?: string;
  note?: string;
}

export function ApprovalsTab() {
  const repos = useRepositories() as RepositoriesWithApprovals;
  const { session } = useAuth();
  const { showSuccess, showError } = useToast();

  const parents = useObservable(() => repos.parents.observe(), []);

  const [pending, setPending] = useState<PendingApprovalWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionModal, setDecisionModal] = useState<ApprovalDecision | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadPending = useCallback(async () => {
    if (!repos.approvals) {
      setError(
        "Supabase n'est pas configuré. Activez VITE_USE_SUPABASE=true dans .env.local pour utiliser cette fonctionnalité.",
      );
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const result = await repos.approvals.listPending("pending");
    if (result.ok) {
      setPending(result.value);
    } else {
      setError(result.error.userMessage ?? result.error.message);
    }
    setIsLoading(false);
  }, [repos.approvals]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const handleApproveExisting = async (request: PendingApprovalWithDetails) => {
    setDecisionModal({
      requestId: request.id,
      type: "approve_existing",
      targetParentId: request.parent_match?.id ?? null,
      note: "",
    });
  };

  const handleApproveNew = (request: PendingApprovalWithDetails) => {
    setDecisionModal({
      requestId: request.id,
      type: "approve_new",
      newParent: {
        first_name: request.full_name?.split(" ")[0] ?? "",
        last_name: request.full_name?.split(" ").slice(1).join(" ") ?? "",
        primary_phone: request.phone ?? "",
        email: request.email,
        national_id: request.national_id ?? "",
        relationship: "father",
      },
      note: "",
    });
  };

  const handleReject = (request: PendingApprovalWithDetails) => {
    setDecisionModal({
      requestId: request.id,
      type: "reject",
      reason: "",
    });
  };

  const submitDecision = async () => {
    if (!decisionModal || !repos.approvals) return;
    setIsSubmitting(true);
    try {
      let result;
      if (decisionModal.type === "approve_existing") {
        if (!decisionModal.targetParentId) {
          showError(
            "Veuillez sélectionner un parent existant pour l'association.",
          );
          setIsSubmitting(false);
          return;
        }
        result = await repos.approvals.approveWithExistingParent(
          decisionModal.requestId,
          decisionModal.targetParentId,
          decisionModal.note,
        );
      } else if (
        decisionModal.type === "approve_new" &&
        decisionModal.newParent
      ) {
        result = await repos.approvals.approveWithNewParent(
          decisionModal.requestId,
          decisionModal.newParent,
          decisionModal.note,
        );
      } else if (decisionModal.type === "reject") {
        if (!decisionModal.reason?.trim()) {
          showError("Une raison de rejet est obligatoire.");
          setIsSubmitting(false);
          return;
        }
        result = await repos.approvals.reject(
          decisionModal.requestId,
          decisionModal.reason,
        );
      }

      if (result?.ok) {
        showSuccess(
          decisionModal.type === "reject"
            ? "Demande rejetée. L'utilisateur a été suspendu."
            : "Compte approuvé. L'utilisateur peut maintenant se connecter à son profil.",
        );
        setDecisionModal(null);
        loadPending();
      } else if (result) {
        showError(result.error.userMessage ?? result.error.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // RBAC check
  if (
    !session ||
    (session.role !== Role.SuperAdmin && session.role !== Role.SupportStaff)
  ) {
    return (
      <Card>
        <CardContent className="py-12">
          <EmptyState
            icon={<AlertTriangle className="h-12 w-12" />}
            title="Accès refusé"
            description="Seuls les SuperAdmin et SupportStaff peuvent approuver les inscriptions."
          />
        </CardContent>
      </Card>
    );
  }

  const filteredPending = pending.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.email.toLowerCase().includes(q) ||
      r.full_name?.toLowerCase().includes(q) ||
      r.phone?.toLowerCase().includes(q) ||
      r.activation_code?.includes(q)
    );
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                File d'attente ({filteredPending.length})
              </CardTitle>
              <CardDescription>
                Les utilisateurs web s'inscrivent via Google OAuth ou email/mot
                de passe. Leur compte reste en attente jusqu'à approbation.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadPending}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
              />
              Rafraîchir
            </Button>
          </div>
          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par email, nom, téléphone, code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState message="Chargement des demandes..." />
          ) : error ? (
            <div className="py-8 text-center text-status-danger">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
              <p className="mb-3">{error}</p>
              <Button variant="outline" size="sm" onClick={loadPending}>
                Réessayer
              </Button>
            </div>
          ) : filteredPending.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-12 w-12" />}
              title="Aucune demande en attente"
              description="Toutes les inscriptions web ont été traitées."
            />
          ) : (
            <div className="space-y-4">
              {filteredPending.map((request) => (
                <ApprovalRequestCard
                  key={request.id}
                  request={request}
                  onApproveExisting={() => handleApproveExisting(request)}
                  onApproveNew={() => handleApproveNew(request)}
                  onReject={() => handleReject(request)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {decisionModal && (
        <DecisionModal
          decision={decisionModal}
          parents={parents}
          isSubmitting={isSubmitting}
          onChange={setDecisionModal}
          onSubmit={submitDecision}
          onCancel={() => setDecisionModal(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// ApprovalRequestCard — single request row
// ============================================================================

function ApprovalRequestCard({
  request,
  onApproveExisting,
  onApproveNew,
  onReject,
}: {
  request: PendingApprovalWithDetails;
  onApproveExisting: () => void;
  onApproveNew: () => void;
  onReject: () => void;
}) {
  const requestedAt = new Date(request.requested_at);
  const expiresAt = new Date(request.expires_at);
  const daysUntilExpiry = Math.ceil(
    (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card hover:border-primary/50 transition-colors">
      {/* Header: email + status + expiry */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-medium truncate">{request.email}</span>
            <Badge variant="outline" className="flex-shrink-0">
              {request.requested_role === "parent"
                ? "Parent"
                : request.requested_role === "student"
                  ? "Élève"
                  : "Personnel"}
            </Badge>
          </div>
          {request.full_name && (
            <div className="text-sm text-muted-foreground ml-6">
              {request.full_name}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <StatusChip tone="warning" label="En attente" />
          {daysUntilExpiry <= 2 && (
            <span className="text-xs text-status-danger font-medium">
              Expire dans {daysUntilExpiry}j
            </span>
          )}
        </div>
      </div>

      {/* Identity details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {request.activation_code && (
          <div className="flex items-center gap-2">
            <KeyRound className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Code:</span>
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              {request.activation_code}
            </code>
          </div>
        )}
        {request.phone && (
          <div className="flex items-center gap-2">
            <Phone className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">{request.phone}</span>
          </div>
        )}
        {request.national_id && (
          <div className="flex items-center gap-2">
            <IdCard className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">
              NN: {request.national_id}
            </span>
          </div>
        )}
        <div className="text-muted-foreground">
          Demandé: {requestedAt.toLocaleDateString("fr-FR")}
        </div>
      </div>

      {request.notes_from_user && (
        <div className="text-sm bg-muted/50 rounded p-2 italic">
          "{request.notes_from_user}"
        </div>
      )}

      {/* Match info */}
      {request.parent_match ? (
        <div className="bg-status-success/10 border border-status-success/30 rounded p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-status-success mb-1">
            <CheckCircle2 className="h-4 w-4" />
            Correspondance détectée par le système
          </div>
          <div className="text-muted-foreground">
            {request.parent_match.parent_code} —{" "}
            {request.parent_match.last_name} {request.parent_match.first_name}
            {request.parent_match.email && ` · ${request.parent_match.email}`}
          </div>
        </div>
      ) : (
        <div className="bg-status-warning/10 border border-status-warning/30 rounded p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-status-warning">
            <AlertTriangle className="h-4 w-4" />
            Aucun parent correspondant détecté automatiquement
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50 mt-2">
        <Button size="sm" onClick={onApproveExisting}>
          <UserCheck className="h-4 w-4 mr-2" />
          Approuver & Lier à un existant
        </Button>
        <Button size="sm" variant="outline" onClick={onApproveNew}>
          <UserPlus className="h-4 w-4 mr-2" />
          Créer un nouveau parent
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReject}
          className="ml-auto text-status-danger hover:bg-status-danger/10 hover:text-status-danger"
        >
          <UserX className="h-4 w-4 mr-2" />
          Rejeter
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// DecisionModal — unified modal for approve/reject decisions
// ============================================================================

function DecisionModal({
  decision,
  parents,
  isSubmitting,
  onChange,
  onSubmit,
  onCancel,
}: {
  decision: ApprovalDecision;
  parents: readonly Parent[];
  isSubmitting: boolean;
  onChange: (d: ApprovalDecision) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [parentQuery, setParentQuery] = useState("");

  const isReject = decision.type === "reject";
  const isApproveNew = decision.type === "approve_new";
  const isApproveExisting = decision.type === "approve_existing";

  const title = isReject
    ? "Rejeter la demande"
    : isApproveNew
      ? "Approuver & Créer un profil parent"
      : "Approuver & Lier au parent existant";

  const selectedParent = decision.targetParentId
    ? parents.find((p) => p.id === decision.targetParentId)
    : null;

  const filteredParents = useMemo(() => {
    if (!parentQuery.trim()) return parents.slice(0, 8);
    const q = parentQuery.toLowerCase();
    return parents
      .filter(
        (p) =>
          parentDisplayName(p).toLowerCase().includes(q) ||
          p.phone.includes(q) ||
          p.code.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [parents, parentQuery]);

  return (
    <UnifiedModal
      open={true}
      onOpenChange={(open) => !open && onCancel()}
      variant="dialog"
      size={isApproveNew ? "lg" : "md"}
      title={title}
      icon={isReject ? UserX : UserCheck}
      iconTone={isReject ? "danger" : "success"}
      submitLoading={isSubmitting}
      onSubmit={onSubmit}
      submitLabel={isReject ? "Rejeter" : "Confirmer l'approbation"}
      submitVariant={isReject ? "destructive" : "default"}
      cancelLabel="Annuler"
      alert={
        isReject
          ? {
              tone: "warning",
              title: "Le compte utilisateur sera suspendu",
              description:
                "L'utilisateur ne pourra pas se connecter après le rejet.",
            }
          : null
      }
    >
      {/* Existing Parent Linking Form */}
      {isApproveExisting && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sélectionnez le dossier parent auquel cet utilisateur doit être
            associé. Aucune nouvelle donnée ne sera dupliquée en base.
          </p>
          <FormField label="Parent cible" required>
            {selectedParent ? (
              <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {parentDisplayName(selectedParent)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedParent.code} · {selectedParent.phone}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({ ...decision, targetParentId: null })
                  }
                >
                  Changer
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={parentQuery}
                    onChange={(e) => setParentQuery(e.target.value)}
                    placeholder="Rechercher un parent (nom, code, tél)..."
                    className="pl-8"
                  />
                </div>
                {filteredParents.length > 0 && (
                  <ul className="rounded-md border border-border max-h-48 overflow-y-auto divide-y divide-border">
                    {filteredParents.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ ...decision, targetParentId: p.id })
                          }
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/5"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {parentDisplayName(p)}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono">
                              {p.code}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {p.phone}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {filteredParents.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Aucun parent trouvé.
                  </p>
                )}
              </div>
            )}
          </FormField>
        </div>
      )}

      {/* New Parent Form */}
      {isApproveNew && decision.newParent && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Un nouveau profil parent va être créé. L'utilisateur web sera
            automatiquement lié à ce dossier.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prénom" required>
              <Input
                value={decision.newParent.first_name}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newParent: {
                      ...decision.newParent!,
                      first_name: e.target.value,
                    },
                  })
                }
              />
            </FormField>
            <FormField label="Nom" required>
              <Input
                value={decision.newParent.last_name}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newParent: {
                      ...decision.newParent!,
                      last_name: e.target.value,
                    },
                  })
                }
              />
            </FormField>
            <FormField label="Téléphone principal" required>
              <Input
                value={decision.newParent.primary_phone}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newParent: {
                      ...decision.newParent!,
                      primary_phone: e.target.value,
                    },
                  })
                }
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                value={decision.newParent.email ?? ""}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newParent: {
                      ...decision.newParent!,
                      email: e.target.value,
                    },
                  })
                }
              />
            </FormField>
            <FormField label="NN (National ID)">
              <Input
                value={decision.newParent.national_id ?? ""}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newParent: {
                      ...decision.newParent!,
                      national_id: e.target.value,
                    },
                  })
                }
              />
            </FormField>
            <FormField label="Relation">
              <Select
                value={decision.newParent.relationship ?? "father"}
                onValueChange={(v) =>
                  onChange({
                    ...decision,
                    newParent: { ...decision.newParent!, relationship: v },
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="father">Père</SelectItem>
                  <SelectItem value="mother">Mère</SelectItem>
                  <SelectItem value="guardian">Tuteur</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Adresse" className="col-span-2">
              <Input
                value={decision.newParent.address ?? ""}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newParent: {
                      ...decision.newParent!,
                      address: e.target.value,
                    },
                  })
                }
              />
            </FormField>
            <FormField label="Ville">
              <Input
                value={decision.newParent.city ?? ""}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newParent: { ...decision.newParent!, city: e.target.value },
                  })
                }
              />
            </FormField>
          </div>
        </div>
      )}

      {/* Reject Form */}
      {isReject && (
        <FormField label="Raison du rejet" required>
          <Textarea
            value={decision.reason ?? ""}
            onChange={(e) => onChange({ ...decision, reason: e.target.value })}
            placeholder="Expliquez pourquoi cette demande est rejetée..."
            rows={4}
          />
        </FormField>
      )}

      {/* Shared Note */}
      {!isReject && (
        <FormField label="Note interne (optionnelle)">
          <Textarea
            value={decision.note ?? ""}
            onChange={(e) => onChange({ ...decision, note: e.target.value })}
            placeholder="Note d'audit conservée avec l'approbation..."
            rows={2}
          />
        </FormField>
      )}
    </UnifiedModal>
  );
}

function FormField({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs font-medium mb-1 block">
        {label} {required && <span className="text-status-danger">*</span>}
      </Label>
      {children}
    </div>
  );
}
