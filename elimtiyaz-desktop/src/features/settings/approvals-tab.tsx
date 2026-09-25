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
  GraduationCap,
  Calendar,
  FileText,
} from "lucide-react";
import type { RepositoriesWithApprovals } from "../../infrastructure/supabase/supabase-repositories";
import type { PendingApprovalWithDetails } from "../../infrastructure/supabase/repositories/supabase-approval-repository";
import { parentDisplayName, type Parent } from "../../domain/model/parent";
import { studentDisplayName, GRADE_LEVELS, GRADE_LEVEL_LABELS_FR, type Student } from "../../domain/model/student";
import type { AcademicClass } from "../../domain/model/academic";

interface ApprovalDecision {
  requestId: string;
  type:
    | "approve_existing"
    | "approve_new"
    | "approve_student_existing"
    | "approve_student_new"
    | "reject";
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
  /** T-413: the bind-existing-student target. */
  targetStudentId?: string | null;
  /** T-413: the new-student creation payload (grade level + class enrollment). */
  newStudent?: {
    first_name: string;
    middle_name?: string;
    last_name: string;
    date_of_birth: string;
    gender?: "male" | "female" | "other";
    grade_level_code?: string;
    class_id?: string;
    medical_notes?: string;
  };
  /** T-413: TRUE when the applicant themselves is the student (the
   * parent-role request is reclassified to student at approval — the
   * EF's assign_role path). */
  applicantIsStudent?: boolean;
  reason?: string;
  note?: string;
}

export function ApprovalsTab() {
  const repos = useRepositories() as RepositoriesWithApprovals;
  const { session } = useAuth();
  const { showSuccess, showError } = useToast();

  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);

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

  // T-413 — bind the approved account to an EXISTING student (the canonical
  // students table, searched by name/code — never a local dataset).
  const handleApproveStudentExisting = (request: PendingApprovalWithDetails) => {
    setDecisionModal({
      requestId: request.id,
      type: "approve_student_existing",
      targetStudentId: request.student_match?.id ?? null,
      applicantIsStudent: request.requested_role !== "student",
      note: "",
    });
  };

  // T-413 — create AND enroll a new student (pre-filled from the website's
  // student_application payload when present).
  const handleApproveStudentNew = (request: PendingApprovalWithDetails) => {
    const app = request.student_application;
    const appStudent = app?.student;
    const hasApplicantParentMatch = !!request.parent_match;
    setDecisionModal({
      requestId: request.id,
      type: "approve_student_new",
      targetParentId: request.parent_match?.id ?? null,
      newParent: hasApplicantParentMatch
        ? undefined
        : {
            first_name: request.full_name?.split(" ")[0] ?? "",
            last_name: request.full_name?.split(" ").slice(1).join(" ") ?? "",
            primary_phone: request.phone ?? "",
            email: request.email,
            national_id: request.national_id ?? "",
            relationship: "father",
          },
      newStudent: {
        first_name: appStudent?.first_name ?? "",
        middle_name: appStudent?.middle_name ?? "",
        last_name: appStudent?.last_name ?? "",
        date_of_birth: appStudent?.date_of_birth ?? "",
        gender: appStudent?.gender,
        grade_level_code: app?.grade_level_code ?? "",
      },
      applicantIsStudent: request.requested_role !== "student",
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
      } else if (
        decisionModal.type === "approve_student_existing"
      ) {
        // T-413: bind the EXISTING student (canonical record) — with the
        // student-role reclassification when the applicant is the student.
        if (!decisionModal.targetStudentId) {
          showError(
            "Veuillez sélectionner un élève existant pour l'association.",
          );
          setIsSubmitting(false);
          return;
        }
        result = await repos.approvals.approveWithExistingStudent(
          decisionModal.requestId,
          decisionModal.targetStudentId,
          decisionModal.note,
          decisionModal.applicantIsStudent ? "student" : undefined,
        );
      } else if (
        decisionModal.type === "approve_student_new" &&
        decisionModal.newStudent
      ) {
        // T-413: create AND enroll the student — one composite server-side
        // transaction (migration 0116). Parent resolution: existing family
        // OR a new parent profile.
        const ns = decisionModal.newStudent;
        if (!ns.first_name.trim() || !ns.last_name.trim() || !ns.date_of_birth) {
          showError(
            "Prénom, nom et date de naissance de l'élève sont obligatoires.",
          );
          setIsSubmitting(false);
          return;
        }
        const parent = decisionModal.targetParentId
          ? ({ kind: "existing", targetParentId: decisionModal.targetParentId } as const)
          : decisionModal.newParent
            ? ({ kind: "new", newParent: decisionModal.newParent } as const)
            : null;
        if (!parent) {
          showError(
            "Sélectionnez une famille existante ou remplissez le nouveau parent.",
          );
          setIsSubmitting(false);
          return;
        }
        result = await repos.approvals.approveWithNewStudent(
          decisionModal.requestId,
          ns,
          parent,
          decisionModal.note,
          decisionModal.applicantIsStudent ? "student" : undefined,
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
        const created =
          decisionModal.type === "approve_student_new" ||
          decisionModal.type === "approve_student_existing";
        showSuccess(
          decisionModal.type === "reject"
            ? "Demande rejetée. L'utilisateur a été suspendu."
            : created
              ? "Élève inscrit et compte approuvé — le dossier est actif dans toute l'application."
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
                  onApproveStudentExisting={() => handleApproveStudentExisting(request)}
                  onApproveStudentNew={() => handleApproveStudentNew(request)}
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
          students={students}
          classes={classes}
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
  onApproveStudentExisting,
  onApproveStudentNew,
  onReject,
}: {
  request: PendingApprovalWithDetails;
  onApproveExisting: () => void;
  onApproveNew: () => void;
  onApproveStudentExisting: () => void;
  onApproveStudentNew: () => void;
  onReject: () => void;
}) {
  const requestedAt = new Date(request.requested_at);
  const expiresAt = new Date(request.expires_at);
  const daysUntilExpiry = Math.ceil(
    (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  // T-413: a "student application" is EITHER an explicit student-role
  // request OR any request carrying the structured student_application
  // payload (the website's enrollment form — the SEC-108 reality: every
  // self-signup lands as 'parent', so the PAYLOAD is the signal).
  const hasApplication = !!request.student_application?.student;
  const isStudentFlow = request.requested_role === "student" || hasApplication;
  const app = request.student_application;
  const appStudent = app?.student;

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
            {hasApplication && (
              <Badge
                variant="outline"
                className="flex-shrink-0 text-[10px] text-primary border-primary/40"
              >
                <GraduationCap className="h-3 w-3 mr-1" />
                Inscription élève
              </Badge>
            )}
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

      {/* T-413: the structured student-application payload (the website's
          enrollment form) — pre-fills the admin's student-creation form. */}
      {appStudent && (
        <div className="bg-primary/5 border border-primary/30 rounded p-3 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-medium text-primary">
            <GraduationCap className="h-4 w-4" />
            Demande d'inscription élève
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-muted-foreground">
            <span>
              {appStudent.first_name} {appStudent.last_name}
            </span>
            {appStudent.date_of_birth && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(appStudent.date_of_birth).toLocaleDateString("fr-FR")}
              </span>
            )}
            {app?.grade_level_code && (
              <span className="flex items-center gap-1">
                <GraduationCap className="h-3 w-3" />
                Niveau : {GRADE_LEVEL_LABELS_FR[app.grade_level_code as keyof typeof GRADE_LEVEL_LABELS_FR] ?? app.grade_level_code}
              </span>
            )}
            {appStudent.gender && (
              <span>{appStudent.gender === "male" ? "Garçon" : "Fille"}</span>
            )}
          </div>
          {app?.note && (
            <div className="text-xs text-muted-foreground italic">"{app.note}"</div>
          )}
        </div>
      )}

      {/* Match info */}
      {request.student_match ? (
        <div className="bg-status-success/10 border border-status-success/30 rounded p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-status-success mb-1">
            <CheckCircle2 className="h-4 w-4" />
            Élève correspondant détecté dans le dossier central
          </div>
          <div className="text-muted-foreground">
            {request.student_match.student_code} — {request.student_match.first_name}{" "}
            {request.student_match.last_name}
          </div>
        </div>
      ) : request.parent_match ? (
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
            Aucun dossier correspondant détecté automatiquement
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50 mt-2">
        {isStudentFlow ? (
          <>
            <Button size="sm" onClick={onApproveStudentNew}>
              <GraduationCap className="h-4 w-4 mr-2" />
              Inscrire un nouvel élève
            </Button>
            <Button size="sm" variant="outline" onClick={onApproveStudentExisting}>
              <UserCheck className="h-4 w-4 mr-2" />
              Lier à un élève existant
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={onApproveExisting}>
              <UserCheck className="h-4 w-4 mr-2" />
              Approuver & Lier à un existant
            </Button>
            <Button size="sm" variant="outline" onClick={onApproveNew}>
              <UserPlus className="h-4 w-4 mr-2" />
              Créer un nouveau parent
            </Button>
          </>
        )}
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
  students,
  classes,
  isSubmitting,
  onChange,
  onSubmit,
  onCancel,
}: {
  decision: ApprovalDecision;
  parents: readonly Parent[];
  students: readonly Student[];
  classes: readonly AcademicClass[];
  isSubmitting: boolean;
  onChange: (d: ApprovalDecision) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [parentQuery, setParentQuery] = useState("");
  const [studentQuery, setStudentQuery] = useState("");

  const isReject = decision.type === "reject";
  const isApproveNew = decision.type === "approve_new";
  const isApproveExisting = decision.type === "approve_existing";
  // T-413 student branches
  const isStudentExisting = decision.type === "approve_student_existing";
  const isStudentNew = decision.type === "approve_student_new";

  const title = isReject
    ? "Rejeter la demande"
    : isStudentNew
      ? "Inscrire un nouvel élève"
      : isStudentExisting
        ? "Lier à un élève existant"
        : isApproveNew
          ? "Approuver & Créer un profil parent"
          : "Approuver & Lier au parent existant";

  const selectedParent = decision.targetParentId
    ? parents.find((p) => p.id === decision.targetParentId)
    : null;

  const selectedStudent = decision.targetStudentId
    ? students.find((s) => s.id === decision.targetStudentId)
    : null;

  const filteredParents = useMemo(() => {
    const match = (p: Parent): boolean => {
      if (!parentQuery.trim()) return true;
      const q = parentQuery.toLowerCase();
      return (
        parentDisplayName(p).toLowerCase().includes(q) ||
        p.phone.includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q)
      );
    };
    return parents.filter(match).slice(0, 8);
  }, [parents, parentQuery]);

  // T-413: the canonical student search (name / code / parent name) — the
  // same repositories the CRM table consumes; NEVER a local/mock dataset.
  const filteredStudents = useMemo(() => {
    const match = (s: Student): boolean => {
      if (!studentQuery.trim()) return true;
      const q = studentQuery.toLowerCase();
      const parent = parents.find((p) => p.id === s.parentId);
      return (
        studentDisplayName(s).toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (parent ? parentDisplayName(parent).toLowerCase().includes(q) : false)
      );
    };
    return students.filter(match).slice(0, 8);
  }, [students, parents, studentQuery]);

  // Classes filtered by the selected grade level (an enrollment aid — the
  // RPC re-validates level/class coherence server-side).
  const levelFilteredClasses = useMemo(() => {
    const level = decision.newStudent?.grade_level_code;
    if (!level) return classes;
    return classes.filter((c) => c.gradeCode === level);
  }, [classes, decision.newStudent?.grade_level_code]);

  // T-331: the 0047 rebind guard rejects approving onto a parent already
  // bound to a DIFFERENT auth user — surface that BEFORE submit, not as a
  // late server error. A selected-but-bound parent blocks confirmation.
  const selectedParentBound =
    !!selectedParent && !!selectedParent.authUserId;

  // T-413 validation gates for the student branches.
  const studentNewInvalid =
    isStudentNew &&
    (!decision.newStudent?.first_name.trim() ||
      !decision.newStudent?.last_name.trim() ||
      !decision.newStudent?.date_of_birth ||
      (!decision.targetParentId && !decision.newParent));

  return (
    <UnifiedModal
      open={true}
      onOpenChange={(open) => !open && onCancel()}
      variant="dialog"
      size={isApproveNew || isStudentNew ? "lg" : "md"}
      title={title}
      icon={isReject ? UserX : isStudentNew || isStudentExisting ? GraduationCap : UserCheck}
      iconTone={isReject ? "danger" : "success"}
      submitLoading={isSubmitting}
      onSubmit={onSubmit}
      submitLabel={isReject ? "Rejeter" : "Confirmer l'approbation"}
      submitVariant={isReject ? "destructive" : "default"}
      submitDisabled={
        (isApproveExisting && (selectedParentBound || !decision.targetParentId)) ||
        (isStudentExisting && !decision.targetStudentId) ||
        studentNewInvalid
      }
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
                  {selectedParentBound && (
                    <p className="mt-1 text-xs font-medium text-status-danger">
                      Ce dossier est déjà lié à un autre compte web — déliez-le
                      d'abord via l'éditeur RBAC (garde anti-remplacement,
                      migration 0047).
                    </p>
                  )}
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
                    placeholder="Rechercher un parent (nom, code, tél, email)..."
                    className="pl-8"
                  />
                </div>
                {filteredParents.length > 0 && (
                  <ul className="rounded-md border border-border max-h-48 overflow-y-auto divide-y divide-border">
                    {filteredParents.map((p) => {
                      const bound = !!p.authUserId;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() =>
                              !bound &&
                              onChange({ ...decision, targetParentId: p.id })
                            }
                            disabled={bound}
                            title={
                              bound
                                ? "Dossier déjà lié à un compte web — déliez-le via l'éditeur RBAC avant l'approbation (0047)"
                                : undefined
                            }
                            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/5 disabled:opacity-50 disabled:cursor-not-allowed"
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
                            {bound && (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-status-warning border-status-warning/40 shrink-0"
                              >
                                Compte lié
                              </Badge>
                            )}
                          </button>
                        </li>
                      );
                    })}
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

      {/* T-413 — Existing Student Linking Form */}
      {isStudentExisting && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sélectionnez le dossier élève central auquel ce compte doit être
            associé. Aucune donnée ne sera dupliquée.
          </p>
          {selectedStudent ? (
            <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">
                  {studentDisplayName(selectedStudent)}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {selectedStudent.code}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({ ...decision, targetStudentId: null })
                }
              >
                Changer
              </Button>
            </div>
          ) : (
            <FormField label="Élève cible" required>
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    placeholder="Rechercher un élève (nom, code, parent)..."
                    className="pl-8"
                  />
                </div>
                {filteredStudents.length > 0 && (
                  <ul className="rounded-md border border-border max-h-48 overflow-y-auto divide-y divide-border">
                    {filteredStudents.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ ...decision, targetStudentId: s.id })
                          }
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/5"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {studentDisplayName(s)}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono">
                              {s.code}
                              {s.classId
                                ? ` · ${classes.find((c) => c.id === s.classId)?.name ?? ""}`
                                : ""}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {filteredStudents.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Aucun élève trouvé.
                  </p>
                )}
              </div>
            </FormField>
          )}
          <ReclassifyToggle decision={decision} onChange={onChange} />
        </div>
      )}

      {/* T-413 — New Student Enrollment Form */}
      {isStudentNew && decision.newStudent && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            L'élève sera créé dans le dossier central (code ELV, inscription en
            classe, historique académique) et le compte approuvé dans la même
            transaction.
          </p>

          {/* Student identity */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prénom (élève)" required>
              <Input
                value={decision.newStudent.first_name}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newStudent: { ...decision.newStudent!, first_name: e.target.value },
                  })
                }
              />
            </FormField>
            <FormField label="Nom (élève)" required>
              <Input
                value={decision.newStudent.last_name}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newStudent: { ...decision.newStudent!, last_name: e.target.value },
                  })
                }
              />
            </FormField>
            <FormField label="Date de naissance" required>
              <Input
                type="date"
                value={decision.newStudent.date_of_birth}
                onChange={(e) =>
                  onChange({
                    ...decision,
                    newStudent: { ...decision.newStudent!, date_of_birth: e.target.value },
                  })
                }
              />
            </FormField>
            <FormField label="Genre">
              <Select
                value={decision.newStudent.gender ?? ""}
                onValueChange={(v) =>
                  onChange({
                    ...decision,
                    newStudent: {
                      ...decision.newStudent!,
                      gender: (v || undefined) as "male" | "female" | "other" | undefined,
                    },
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Garçon</SelectItem>
                  <SelectItem value="female">Fille</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Niveau scolaire">
              <Select
                value={decision.newStudent.grade_level_code ?? ""}
                onValueChange={(v) =>
                  onChange({
                    ...decision,
                    newStudent: {
                      ...decision.newStudent!,
                      grade_level_code: v || undefined,
                      class_id: undefined,
                    },
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {GRADE_LEVELS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {GRADE_LEVEL_LABELS_FR[g]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Classe (inscription)">
              <Select
                value={decision.newStudent.class_id ?? ""}
                onValueChange={(v) =>
                  onChange({
                    ...decision,
                    newStudent: {
                      ...decision.newStudent!,
                      class_id: v || undefined,
                    },
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {levelFilteredClasses.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Aucune classe pour ce niveau.
                    </p>
                  )}
                  {levelFilteredClasses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name ?? c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <ReclassifyToggle decision={decision} onChange={onChange} />

          {/* Parent resolution */}
          <div className="border-t border-border/60 pt-3 space-y-3">
            <p className="text-xs font-semibold text-foreground">
              Famille de l'élève
            </p>
            {decision.targetParentId && selectedParent ? (
              <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {parentDisplayName(selectedParent)}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {selectedParent.code} · {selectedParent.phone}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...decision,
                      targetParentId: null,
                      newParent: decision.newParent ?? {
                        first_name: "",
                        last_name: "",
                        primary_phone: "",
                        email: undefined,
                      },
                    })
                  }
                >
                  Nouvelle famille
                </Button>
              </div>
            ) : decision.newParent ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Un nouveau profil parent va être créé (famille de l'élève).
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange({ ...decision, newParent: undefined })}
                  >
                    Annuler
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Prénom (parent)" required>
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
                  <FormField label="Nom (parent)" required>
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
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() =>
                      onChange({
                        ...decision,
                        newParent: undefined,
                        targetParentId: null,
                      })
                    }
                  >
                    Choisir une famille existante à la place
                  </Button>
                </div>
              </div>
            ) : (
              <FormField label="Famille existante">
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={parentQuery}
                      onChange={(e) => setParentQuery(e.target.value)}
                      placeholder="Rechercher une famille (nom, code, tél, email)..."
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      onChange({
                        ...decision,
                        newParent: {
                          first_name: "",
                          last_name: "",
                          primary_phone: "",
                        },
                      })
                    }
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Créer une nouvelle famille
                  </Button>
                </div>
              </FormField>
            )}
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

/**
 * T-413 — the applicant-is-the-student reclassification toggle.
 *
 * Every website self-signup lands as requested_role='parent' (0054/SEC-108:
 * the client cannot claim a role). When the admin recognises the Google
 * account belongs to the STUDENT themselves, this toggle reclassifies the
 * request at approval time (the EF's assign_role='student' path) — the
 * composite then binds students.auth_user_id instead of the parent's, giving
 * the student their own portal access to their canonical record.
 */
function ReclassifyToggle({
  decision,
  onChange,
}: {
  decision: ApprovalDecision;
  onChange: (d: ApprovalDecision) => void;
}) {
  const checked = decision.applicantIsStudent ?? false;
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) =>
          onChange({ ...decision, applicantIsStudent: e.target.checked })
        }
        className="mt-0.5"
      />
      <span className="text-xs">
        <span className="font-medium block">
          Le demandeur EST l'élève (son propre compte Google)
        </span>
        <span className="text-muted-foreground">
          Reclassifie la demande en compte élève : le portail de l'élève
          ouvrira sur SON dossier central (et non sur le compte parent).
        </span>
      </span>
    </label>
  );
}
