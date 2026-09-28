/**
 * T-437 (issue #18 §2–§4 / UI-319 / ADR-031): the dedicated « Réinscription »
 * tab — the transition manager for EXISTING students entering the new
 * academic year (NOT a new-student creation surface).
 *
 * The components:
 *  - the year bar: the source year (the year being completed) + the target
 *    year (with the create-next-year action when it does not exist yet);
 *  - the candidate worklist generated from the FINALIZED pedagogical
 *    results (INV-22): previous year/class, the final result, the
 *    pass/fail/repeating status, the expected next level, the current
 *    re-enrollment status;
 *  - the per-candidate actions: « Réinscrire » (the pre-filled form),
 *    « Ne continue pas » (the recorded decision), « Annuler » (back to
 *    waiting);
 *  - the red badge: the count of candidates still WAITING for a decision
 *    (reported to the page tab through `onWaitingCountChange`);
 *  - the freeze: refuses while waiting candidates remain (INV-23b).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Snowflake, UserCheck, UserX, Undo2, CalendarPlus } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { Card, CardContent } from "../../../shared/ui/card";
import { DataTable, type DataTableColumn, type DataTableAction } from "../../../shared/ui/data-table";
import { EmptyState } from "../../../shared/layout/state-views";
import { StatusChip } from "../../../shared/ui/status-chip";
import { ConfirmModal } from "../../../shared/ui/unified-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import type { AcademicYear } from "../../../domain/model/academic";
import { GRADE_LEVEL_LABELS_FR } from "../../../domain/model/student";
import { PROMOTION_DECISION_LABELS_FR } from "../../../domain/model/academic";
import type { ReEnrollmentCandidate, ReEnrollmentList } from "../../../domain/model/re-enrollment";
import { RE_ENROLLMENT_STATUS_LABELS_FR } from "../../../domain/model/re-enrollment";
import { ReEnrollModal } from "./re-enroll-modal";

export function ReEnrollmentTab({
  onWaitingCountChange,
}: {
  onWaitingCountChange?: (count: number) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const years = useObservable(() => repos.academicYears.observeAll(), []);

  // The year pair (defaults: source = the current/most recent year;
  // target = the next year in sequence when it exists).
  const [sourceYearId, setSourceYearId] = useState<string>("");
  const [targetYearId, setTargetYearId] = useState<string>("");
  const [list, setList] = useState<ReEnrollmentList | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reEnrollCandidate, setReEnrollCandidate] = useState<ReEnrollmentCandidate | null>(null);
  const [pendingNotContinuing, setPendingNotContinuing] = useState<ReEnrollmentCandidate | null>(null);
  const [pendingFreeze, setPendingFreeze] = useState(false);

  const actorId = session?.userId ?? "staff";
  const actorName = session?.displayName ?? "Session courante";

  const sortedYears = useMemo(
    () =>
      [...(years ?? [])]
        .filter((y) => !y.isArchived)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [years],
  );

  // Default the year pair once the years load.
  useEffect(() => {
    if (!sourceYearId && sortedYears.length > 0) {
      const current =
        sortedYears.find((y) => y.isCurrent) ?? sortedYears[sortedYears.length - 1];
      setSourceYearId(current.id);
    }
  }, [sortedYears, sourceYearId]);

  const sourceYear = sortedYears.find((y) => y.id === sourceYearId) ?? null;
  const targetCandidates = useMemo(
    () => sortedYears.filter((y) => y.startDate > (sourceYear?.startDate ?? "9999")),
    [sortedYears, sourceYear],
  );

  useEffect(() => {
    if (targetYearId && !targetCandidates.some((y) => y.id === targetYearId)) {
      setTargetYearId("");
    }
  }, [targetCandidates, targetYearId]);

  // The expected NEXT year code ("2026-2027" → "2027-2028") for the
  // create-target-year action.
  const nextYearCode = useMemo(() => {
    if (!sourceYear) return null;
    const m = /^(\d{4})-(\d{4})$/.exec(sourceYear.code ?? sourceYear.label ?? "");
    if (!m) return null;
    return `${Number(m[1]) + 1}-${Number(m[2]) + 1}`;
  }, [sourceYear]);
  const nextYearExists =
    !!nextYearCode &&
    sortedYears.some((y) => (y.code ?? y.label) === nextYearCode);

  const refresh = useCallback(async () => {
    if (!targetYearId) {
      setList(null);
      onWaitingCountChange?.(0);
      return;
    }
    setLoading(true);
    try {
      const res = await repos.reEnrollment.listCandidates(targetYearId);
      if (res.ok) {
        setList(res.value);
        onWaitingCountChange?.(res.value.waitingCount);
      } else {
        toast.showError("Chargement impossible", res.error.userMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [repos, targetYearId, toast, onWaitingCountChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleGenerate() {
    if (!sourceYearId || !targetYearId) return;
    setGenerating(true);
    try {
      const res = await repos.reEnrollment.generateCandidates({
        sourceAcademicYearId: sourceYearId,
        targetAcademicYearId: targetYearId,
        performedBy: actorId,
        performedByName: actorName,
      });
      if (res.ok) {
        toast.showSuccess(
          "Liste générée",
          `${res.value.candidatesWritten} écriture(s) — ${res.value.totalRows} candidat(s) au total pour ${res.value.targetAcademicYear}.`,
        );
        await refresh();
      } else {
        toast.showError("Génération impossible", res.error.userMessage);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreateTargetYear() {
    if (!sourceYear || !nextYearCode) return;
    setBusy(true);
    try {
      const start = `${nextYearCode.slice(0, 4)}-09-01`;
      const end = `${nextYearCode.slice(5)}-06-30`;
      const res = await repos.academicYears.createAcademicYear(
        {
          label: nextYearCode,
          code: nextYearCode,
          startDate: start,
          endDate: end,
          termStructure: sourceYear.termStructure ?? "trimester",
          isCurrent: false,
        },
        actorId,
        actorName,
      );
      if (res.ok) {
        toast.showSuccess(
          "Année cible créée",
          `${nextYearCode} est disponible — générez la liste de réinscription.`,
        );
        setTargetYearId(res.value.id);
      } else {
        toast.showError("Création impossible", res.error.userMessage);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDecision(
    candidate: ReEnrollmentCandidate,
    decision: "not_continuing" | "waiting",
  ) {
    setBusy(true);
    try {
      const res = await repos.reEnrollment.setDecision({
        reEnrollmentId: candidate.reEnrollmentId,
        decision,
        notes: null,
        performedBy: actorId,
        performedByName: actorName,
      });
      if (res.ok) {
        toast.showSuccess(
          decision === "not_continuing" ? "Décision enregistrée" : "Décision annulée",
          decision === "not_continuing"
            ? `${candidate.studentFirstName} ${candidate.studentLastName} ne continuera pas en ${candidate.targetAcademicYear}.`
            : `${candidate.studentFirstName} ${candidate.studentLastName} est de retour en attente de décision.`,
        );
        await refresh();
      } else {
        toast.showError("Décision impossible", res.error.userMessage);
      }
    } finally {
      setBusy(false);
      setPendingNotContinuing(null);
    }
  }

  async function handleFreeze() {
    if (!targetYearId) return;
    setBusy(true);
    try {
      const res = await repos.reEnrollment.freeze(targetYearId, actorId, actorName);
      if (res.ok) {
        toast.showSuccess(
          "Liste figée",
          `${res.value.frozenCount} candidat(s) figé(s) pour l'année cible — plus aucune modification possible.`,
        );
        await refresh();
      } else {
        toast.showError("Gel impossible", res.error.userMessage);
      }
    } finally {
      setBusy(false);
      setPendingFreeze(false);
    }
  }

  const columns: readonly DataTableColumn<ReEnrollmentCandidate>[] = [
    {
      header: "Élève",
      accessor: (c) => `${c.studentLastName} ${c.studentFirstName}`,
      cell: (c) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {c.studentFirstName} {c.studentLastName}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {c.studentCode} · {c.parentDisplayName}
          </p>
        </div>
      ),
    },
    {
      header: "Année précédente",
      accessor: "sourceAcademicYear",
      cell: (c) => (
        <div className="text-xs">
          <p>{c.sourceAcademicYear}</p>
          <p className="text-muted-foreground">
            {c.sourceClassName ?? "—"}
            {c.sourceGradeLevelCode
              ? ` · ${GRADE_LEVEL_LABELS_FR[c.sourceGradeLevelCode as keyof typeof GRADE_LEVEL_LABELS_FR] ?? c.sourceGradeLevelCode}`
              : ""}
          </p>
        </div>
      ),
      className: "hidden md:table-cell",
    },
    {
      header: "Résultat final",
      accessor: (c) => c.finalDecision ?? "—",
      cell: (c) =>
        c.finalDecision ? (
          <div className="text-xs">
            <Badge
              variant={
                c.finalDecision === "promoted"
                  ? "success"
                  : c.finalDecision === "repeated"
                    ? "warning"
                    : "outline"
              }
            >
              {PROMOTION_DECISION_LABELS_FR[c.finalDecision]}
            </Badge>
            {c.finalAverage != null && (
              <p className="text-muted-foreground mt-0.5">{c.finalAverage.toFixed(2)}/20</p>
            )}
          </div>
        ) : (
          <Badge variant="outline" className="text-amber-600">Non finalisé</Badge>
        ),
      className: "hidden md:table-cell",
    },
    {
      header: "Niveau proposé",
      accessor: (c) => c.expectedGradeLevelCode ?? "—",
      cell: (c) => (
        <span className="text-xs">
          {c.expectedGradeLevelCode
            ? (GRADE_LEVEL_LABELS_FR[c.expectedGradeLevelCode as keyof typeof GRADE_LEVEL_LABELS_FR] ?? c.expectedGradeLevelCode)
            : "—"}
        </span>
      ),
      className: "hidden lg:table-cell",
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (c) => (
        <StatusChip
          label={RE_ENROLLMENT_STATUS_LABELS_FR[c.status]}
          tone={
            c.status === "waiting"
              ? "danger"
              : c.status === "re_enrolled"
                ? "success"
                : c.status === "started"
                  ? "warning"
                  : "neutral"
          }
        />
      ),
      sortable: true,
    },
  ];

  const actions: readonly DataTableAction<ReEnrollmentCandidate>[] = [
    ...(list?.frozen
      ? []
      : [
          {
            label: "Réinscrire",
            icon: <UserCheck className="h-4 w-4 text-status-success" />,
            variant: "ghost" as const,
            onClick: (c: ReEnrollmentCandidate) => setReEnrollCandidate(c),
            disabled: (c: ReEnrollmentCandidate) => c.status === "re_enrolled" || c.status === "not_continuing",
            title: "Ouvrir le formulaire pré-rempli",
          },
          {
            label: "Ne continue pas",
            icon: <UserX className="h-4 w-4 text-status-danger" />,
            variant: "ghost" as const,
            onClick: (c: ReEnrollmentCandidate) => setPendingNotContinuing(c),
            disabled: (c: ReEnrollmentCandidate) => c.status !== "waiting" && c.status !== "started",
            title: "Enregistrer la décision de non-continuation",
          },
          {
            label: "",
            icon: <Undo2 className="h-4 w-4" />,
            variant: "ghost" as const,
            onClick: (c: ReEnrollmentCandidate) => void handleDecision(c, "waiting"),
            disabled: (c: ReEnrollmentCandidate) => c.status !== "started" && c.status !== "not_continuing",
            title: "Remettre en attente de décision",
          },
        ]),
  ];

  return (
    <div className="space-y-3">
      {/* The year bar */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-44">
              <p className="text-xs text-muted-foreground mb-1">Année source (à finaliser)</p>
              <Select value={sourceYearId || undefined} onValueChange={(v) => setSourceYearId(v)}>
                <SelectTrigger><SelectValue placeholder="Année source…" /></SelectTrigger>
                <SelectContent>
                  {sortedYears.map((y: AcademicYear) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.code ?? y.label} {y.isCurrent ? "(courante)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-44">
              <p className="text-xs text-muted-foreground mb-1">Année cible</p>
              <Select value={targetYearId || undefined} onValueChange={(v) => setTargetYearId(v)}>
                <SelectTrigger><SelectValue placeholder="Année cible…" /></SelectTrigger>
                <SelectContent>
                  {targetCandidates.map((y) => (
                    <SelectItem key={y.id} value={y.id}>{y.code ?? y.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {nextYearCode && !nextYearExists && (
              <Button variant="outline" onClick={handleCreateTargetYear} disabled={busy || !sourceYearId}>
                <CalendarPlus className="h-4 w-4" /> Créer {nextYearCode}
              </Button>
            )}
            <Button
              onClick={handleGenerate}
              disabled={generating || !sourceYearId || !targetYearId || !!list?.frozen}
            >
              <RefreshCw className={generating ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {generating ? "Génération…" : "Générer / Rafraîchir la liste"}
            </Button>
            {list && list.totalCount > 0 && !list.frozen && (
              <Button
                variant="outline"
                onClick={() => setPendingFreeze(true)}
                disabled={busy || list.waitingCount > 0}
                title={list.waitingCount > 0 ? `${list.waitingCount} candidat(s) encore en attente — décidez chaque élève avant de figer` : "Figer la liste (fin de revue)"}
              >
                <Snowflake className="h-4 w-4" /> Figer la liste
              </Button>
            )}
          </div>

          {/* The summary chips — the red pending badge mirrors the tab badge. */}
          {list && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="danger">{list.waitingCount} en attente de décision</Badge>
              <Badge variant="warning">{list.startedCount} commencée(s)</Badge>
              <Badge variant="success">{list.reEnrolledCount} réinscrit(s)</Badge>
              <Badge variant="outline">{list.notContinuingCount} ne continue(nt) pas</Badge>
              <span className="text-muted-foreground">{list.totalCount} candidat(s) au total</span>
            </div>
          )}
          {list?.frozen && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Liste FIGÉE — la revue de réinscription est terminée pour cette année cible
              (aucune génération, décision ou réinscription possible).
            </div>
          )}
          {!list?.frozen && (
            <p className="text-[11px] text-muted-foreground">
              La liste se génère à partir des résultats pédagogiques FINALISÉS de l'année
              source (cycles de promotion). Les élèves sans résultat finalisé apparaissent
              avec « Non finalisé » — le niveau proposé est alors une dérivation.
            </p>
          )}
        </CardContent>
      </Card>

      {/* The worklist */}
      {list && list.candidates.length > 0 ? (
        <Card>
          <CardContent className="p-3">
            <DataTable<ReEnrollmentCandidate>
              data={list.candidates}
              columns={columns}
              actions={actions}
              searchFields={["studentFirstName", "studentLastName", "studentCode", "parentDisplayName"]}
              searchPlaceholder="Rechercher un élève ou un parent…"
              emptyMessage="Aucun candidat ne correspond à votre recherche."
              onRowClick={(c) =>
                !list.frozen && c.status !== "re_enrolled" && c.status !== "not_continuing"
                  ? setReEnrollCandidate(c)
                  : undefined
              }
              getRowId={(c) => c.reEnrollmentId}
              pageSize={12}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title={targetYearId ? "Aucun candidat généré" : "Sélectionnez l'année source et l'année cible"}
              description={
                targetYearId
                  ? "Cliquez sur « Générer / Rafraîchir la liste » pour materialiser les candidats de réinscription à partir du registre actif."
                  : "La réinscription gère la transition des élèves EXISTANTS vers la nouvelle année scolaire — choisissez d'abord l'année à finaliser puis l'année cible."
              }
            />
          </CardContent>
        </Card>
      )}

      {/* The pre-filled re-enrollment form */}
      <ReEnrollModal
        open={reEnrollCandidate !== null}
        onOpenChange={(o) => !o && setReEnrollCandidate(null)}
        candidate={reEnrollCandidate}
        onReEnrolled={() => {
          setReEnrollCandidate(null);
          void refresh();
        }}
      />

      {/* The not-continuing confirmation (the decision is RECORDED, never left unresolved). */}
      <ConfirmModal
        open={pendingNotContinuing !== null}
        onOpenChange={(o) => !o && setPendingNotContinuing(null)}
        title="Confirmer la non-continuation"
        description={
          pendingNotContinuing
            ? `${pendingNotContinuing.studentFirstName} ${pendingNotContinuing.studentLastName} (${pendingNotContinuing.studentCode}) sera enregistré comme ne continuant pas en ${pendingNotContinuing.targetAcademicYear}. La décision reste modifiable jusqu'au gel de la liste.`
            : ""
        }
        confirmLabel="Enregistrer la décision"
        onConfirm={() =>
          pendingNotContinuing ? handleDecision(pendingNotContinuing, "not_continuing") : Promise.resolve()
        }
      />

      {/* The freeze confirmation */}
      <ConfirmModal
        open={pendingFreeze}
        onOpenChange={(o) => !o && setPendingFreeze(false)}
        title="Figer la liste de réinscription ?"
        description="Une fois figée, plus aucune décision ni réinscription ne sera possible pour cette année cible. Assurez-vous que chaque élève a une décision enregistrée."
        confirmLabel="Figer définitivement"
        destructive
        onConfirm={handleFreeze}
      />
      {loading && <p className="text-xs text-muted-foreground px-1">Chargement…</p>}
    </div>
  );
}
