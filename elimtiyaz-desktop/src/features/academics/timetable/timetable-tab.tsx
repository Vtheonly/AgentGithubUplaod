// ============================================================================
// FILE: src/features/academics/timetable/timetable-tab.tsx
// ============================================================================
/**
 * The dedicated Timetable / Emploi du temps staff area — T-404.
 *
 * The canonical presentation surface for the generated schedule (ADR-020):
 *   - Emploi du temps : the class/teacher/room grid over the selected
 *     version (draft review or the published live EDT);
 *   - Essais & publication : generation trials, statistics, conflict
 *     explanations, and the review → approve → publish workflow;
 *   - Configuration : the school week + periods + breaks (the Algerian
 *     profile is seeded data — Sun–Thu, 6 periods — fully editable);
 *   - Salles : the room catalog (types + capacities);
 *   - Contraintes : hard/soft constraints (free days, unavailability…).
 *
 * Everything reads the ONE TimetableRepository — no page-local schedule
 * stores, no page-local algorithms (T-404 no-duplicate rule).
 */

import { useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  DoorOpen,
  GitBranch,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { ConfirmModal } from "../../../shared/ui/unified-modal";
import { Permission } from "../../../core/rbac/permissions";
import { can } from "../../../core/rbac/session";
import { useCurrentAcademicYear } from "../hooks/use-current-academic-year";
import { TimetableGrid, type TimetableViewMode } from "./timetable-grid";
import { TimetableEntryDialog } from "./timetable-entry-dialog";
import {
  ROOM_TYPES,
  TIMETABLE_CONSTRAINT_KINDS,
  TIMETABLE_DAY_LABELS_FR,
  TIMETABLE_GENERATION_STAGE_LABELS_FR,
  TIMETABLE_VERSION_STATUS_LABELS_FR,
  timetableCoveragePercent,
  timetableGenerationProgressPercent,
  type Room,
  type TimetableDay,
  type TimetableConstraint,
  type TimetableGenerationProgress,
  type TimetableScheduleEntry,
  type TimetableVersion,
} from "../../../domain/model/timetable";
import type { ActorContext } from "../../../domain/repository/timetable-repository";

type SubTab = "schedule" | "trials" | "configuration" | "rooms" | "constraints";

const ROOM_TYPE_LABELS: Record<string, string> = {
  classroom: "Salle de classe",
  science_lab: "Labo sciences",
  computer_lab: "Salle info",
  language_lab: "Labo langues",
  sports: "Sport",
  library: "Bibliothèque",
  workshop: "Atelier",
  other: "Autre",
};

const CONSTRAINT_KIND_LABELS: Record<string, string> = {
  free_day: "Jour libre",
  unavailable_period: "Période indisponible",
  max_daily_lessons: "Max périodes / jour",
  max_weekly_hours: "Max heures / semaine",
  max_consecutive: "Max périodes consécutives",
  preferred_period: "Période préférée",
  avoid_first_period: "Éviter la 1re période",
  avoid_last_period: "Éviter la dernière période",
  prefer_morning: "Préférer le matin",
  prefer_afternoon: "Préférer l'après-midi",
  minimize_gaps: "Minimiser les trous",
};

export function TimetableTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toasts = useToast();
  const year = useCurrentAcademicYear();

  const [subTab, setSubTab] = useState<SubTab>("schedule");
  const [viewMode, setViewMode] = useState<TimetableViewMode>("class");
  const [viewEntityId, setViewEntityId] = useState<string>("__all__");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // T-409: REAL generation progress — the live event stream from the
  // actual run (loading → preparing → placing → repairing → validating →
  // saving), never a timer. Null when no generation is in flight.
  const [genProgress, setGenProgress] = useState<TimetableGenerationProgress | null>(
    null,
  );
  const [adjustEntry, setAdjustEntry] = useState<TimetableScheduleEntry | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
  const [constraintToDelete, setConstraintToDelete] =
    useState<TimetableConstraint | null>(null);

  const canManage = can(session, Permission.ManageSchoolYears);

  const actor: ActorContext = useMemo(
    () => ({ actorId: session?.userId ?? "", actorName: session?.displayName ?? "—" }),
    [session],
  );

  // ── Data ────────────────────────────────────────────────────────────────
  // T-408 (ACAD-509): the year context is canonical data — the synthetic
  // "ay-2025-2026" fallback was removed from the hook. READS fall back to
  // "" (matches no row in either implementation → the honest empty state);
  // WRITES are blocked by the no-year banner below.
  const yearId = year.id ?? "";
  const configuration = useObservable(
    () => repos.timetable.observeConfiguration(yearId),
    [yearId],
  );
  const rooms = useObservable(() => repos.timetable.observeRooms(), []) ?? [];
  const constraints =
    useObservable(() => repos.timetable.observeConstraints(yearId), [yearId]) ?? [];
  const versions =
    useObservable(() => repos.timetable.observeVersions(yearId), [yearId]) ?? [];
  const publishedEntries =
    useObservable(
      () => repos.timetable.observePublishedEntries(yearId),
      [yearId],
    ) ?? [];
  const classes = useObservable(() => repos.classes.observe(), []) ?? [];
  const subjects = useObservable(() => repos.subjects.observe(), []) ?? [];
  const personnel = useObservable(() => repos.personnel.observe(), []) ?? [];

  const selectedVersion: TimetableVersion | null = useMemo(() => {
    if (versions.length === 0) return null;
    if (selectedVersionId) {
      return versions.find((v) => v.id === selectedVersionId) ?? null;
    }
    return versions.find((v) => v.status === "published") ?? versions[0];
  }, [versions, selectedVersionId]);

  const draftEntries = useObservable(
    () =>
      selectedVersion
        ? repos.timetable.observeEntries(selectedVersion.id)
        : { get: () => [] as TimetableScheduleEntry[], subscribe: () => () => {} },
    [selectedVersion?.id],
  ) ?? [];

  const entries =
    selectedVersion && selectedVersion.status !== "published"
      ? draftEntries
      : publishedEntries;

  // Names for the grid projections.
  const names = useMemo(
    () => ({
      classes: new Map(classes.map((c) => [c.id, c.name ?? c.code])),
      subjects: new Map(
        subjects.map((s) => [s.id, s.name] as [string, string]),
      ),
      teachers: new Map(
        personnel.map((p) => [p.id, `${p.firstName} ${p.lastName}`]),
      ),
      rooms: new Map(rooms.map((r) => [r.id, `${r.code} — ${r.name}`])),
    }),
    [classes, subjects, personnel, rooms],
  );

  const viewEntities = useMemo(() => {
    switch (viewMode) {
      case "class":
        return classes.map((c) => ({ id: c.id, label: c.name ?? c.code }));
      case "teacher":
        return personnel
          .filter((p) => p.staffCategory === "teacher")
          .map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}` }));
      case "room":
        return rooms.map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` }));
    }
  }, [viewMode, classes, personnel, rooms]);

  // T-409 / SCHED-111 — the class-first contract: "Par classe" ALWAYS has
  // an explicit class. The selector never offers "Tout afficher"; when no
  // valid class is selected (first open, stale id, mode switch), the FIRST
  // class is the default. The grid is scoped strictly to this id.
  const classViewEntityId = useMemo(() => {
    if (viewEntityId !== "__all__" && classes.some((c) => c.id === viewEntityId)) {
      return viewEntityId;
    }
    return classes[0]?.id ?? null;
  }, [viewEntityId, classes]);

  const selectedClassLabel = useMemo(() => {
    const cls = classes.find((c) => c.id === classViewEntityId);
    return cls ? (cls.name ?? cls.code) : null;
  }, [classes, classViewEntityId]);

  const editable =
    canManage &&
    selectedVersion != null &&
    (selectedVersion.status === "draft" || selectedVersion.status === "in_review");

  // ── Actions ─────────────────────────────────────────────────────────────
  async function generate(fromVersionId?: string): Promise<void> {
    if (!year.id) {
      toasts.showError(
        "Aucune année scolaire active",
        "Définissez l'année scolaire courante avant de générer l'emploi du temps.",
      );
      return;
    }
    setBusy(true);
    // T-409: REAL generation progress — the live event stream from the
    // actual run (loading → preparing → placing → repairing → validating →
    // saving), never a timer.
    setGenProgress({
      stage: "loading",
      processed: 0,
      total: 0,
      message: "Chargement des données…",
    });
    try {
      const result = await repos.timetable.generateTimetable(
        {
          academicYearId: year.id,
          fromVersionId: fromVersionId ?? null,
          // T-409: REAL progress from the actual run (solver work units +
          // persistence stages — never a timer).
          onProgress: setGenProgress,
        },
        actor,
      );
      if (result.ok) {
        const stats = result.value.statistics as Record<string, unknown>;
        const placed = Number(stats?.placedPeriods ?? 0);
        const required = Number(stats?.requiredPeriods ?? 0);
        const coverage = timetableCoveragePercent(placed, required);
        toasts.showSuccess(
          "Génération terminée",
          `${placed} périodes placées, ${result.value.unplacedCount} non placées — couverture ${coverage}% (essai ${result.value.versionNumber}).`,
        );
        setSelectedVersionId(result.value.id);
        setSubTab("trials");
      } else {
        toasts.showError("Génération impossible", result.error.message);
      }
    } finally {
      setBusy(false);
      setGenProgress(null);
    }
  }

  async function workflow(
    version: TimetableVersion,
    action: "submit" | "approve" | "reject" | "publish" | "duplicate",
  ): Promise<void> {
    setBusy(true);
    try {
      const result =
        action === "submit"
          ? await repos.timetable.submitForReview(version.id, actor)
          : action === "approve"
            ? await repos.timetable.approveVersion(version.id, actor)
            : action === "reject"
              ? await repos.timetable.rejectVersion(version.id, actor)
              : action === "publish"
                ? await repos.timetable.publishVersion(version.id, actor)
                : await repos.timetable.duplicateVersionToDraft(version.id, actor);
      if (result.ok) {
        toasts.showSuccess(
          action === "publish"
            ? "Emploi du temps publié"
            : action === "duplicate"
              ? "Brouillon créé"
              : "Statut mis à jour",
          `Version ${result.value.versionNumber} → ${TIMETABLE_VERSION_STATUS_LABELS_FR[result.value.status]}`,
        );
        if (action === "duplicate") {
          setSelectedVersionId(result.value.id);
          setSubTab("schedule");
        }
      } else {
        toasts.showError("Action refusée", result.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────
  const statusBadge = (status: TimetableVersion["status"]) => {
    const tone =
      status === "published"
        ? "bg-status-success/15 text-status-success"
        : status === "approved"
          ? "bg-primary/15 text-primary"
          : status === "draft"
            ? "bg-muted text-muted-foreground"
            : status === "in_review"
              ? "bg-status-warning/15 text-status-warning"
              : "bg-status-danger/10 text-muted-foreground";
    return (
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
        {TIMETABLE_VERSION_STATUS_LABELS_FR[status]}
      </span>
    );
  };

  const violationsOf = (v: TimetableVersion): Array<{ severity: string; message: string }> => {
    const stats = v.statistics as Record<string, unknown>;
    const list = Array.isArray(stats?.violations)
      ? (stats.violations as Array<{ severity: string; message: string }>)
      : [];
    return list;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* T-408 (ACAD-509): honest no-year guard — every timetable write
          surface is unreachable until an academic year is flagged current
          (never the removed synthetic "ay-2025-2026" fallback). */}
      {!year.id && (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            Aucune année scolaire active
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Définissez l'année scolaire courante dans Années scolaires avant de
            configurer ou générer l'emploi du temps.
          </p>
        </div>
      )}
      {/* ── Sub-tabs ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["schedule", "Emploi du temps", <CalendarDays key="i" className="h-3.5 w-3.5" />],
            ["trials", "Essais & publication", <GitBranch key="i" className="h-3.5 w-3.5" />],
            ["configuration", "Configuration", <Settings2 key="i" className="h-3.5 w-3.5" />],
            ["rooms", "Salles", <DoorOpen key="i" className="h-3.5 w-3.5" />],
            ["constraints", "Contraintes", <ListChecks key="i" className="h-3.5 w-3.5" />],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubTab(key as SubTab)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ── T-409: REAL generation progress surface ────────────────── */}
      {genProgress && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm font-medium text-foreground">
                    Génération de l'emploi du temps
                  </span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {TIMETABLE_GENERATION_STAGE_LABELS_FR[genProgress.stage]}
                  </span>
                </div>
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {genProgress.total > 0
                    ? // Real percentage from actual work units — never a
                      // timer; held below 100% until the trial is persisted.
                      `${timetableGenerationProgressPercent(genProgress)}%`
                    : "…"}
                </span>
              </div>
              {/* progressPercent = round(processedWorkUnits / totalWorkUnits * 100) */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full bg-primary transition-[width] duration-150 ${
                    genProgress.total <= 0 ? "animate-pulse" : ""
                  }`}
                  style={{
                    width: `${
                      genProgress.total > 0
                        ? Math.min(
                            99,
                            timetableGenerationProgressPercent(genProgress),
                          )
                        : 100
                    }%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {genProgress.message}
                {genProgress.total > 0 && (
                  <span className="tabular-nums">
                    {"\u00a0("}
                    {genProgress.processed} / {genProgress.total} unités de travail)
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── SCHEDULE ─────────────────────────────────────────────────── */}
      {subTab === "schedule" && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="h-4 w-4 text-primary" />
              Emploi du temps — {year.code ?? "année active"}
              {selectedVersion && (
                <span className="text-xs font-normal text-muted-foreground">
                  v{selectedVersion.versionNumber}
                </span>
              )}
              {selectedVersion && statusBadge(selectedVersion.status)}
              {/* T-409: the selected class is explicit and visible in the
                  class-first workflow. */}
              {viewMode === "class" && selectedClassLabel && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                  Classe : {selectedClassLabel}
                </span>
              )}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedVersionId ?? selectedVersion?.id ?? ""}
                onValueChange={(v) => setSelectedVersionId(v)}
              >
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue placeholder="Version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      v{v.versionNumber} · {TIMETABLE_VERSION_STATUS_LABELS_FR[v.status]}
                      {v.label ? ` — ${v.label}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={viewMode} onValueChange={(v) => {
                setViewMode(v as TimetableViewMode);
                setViewEntityId("__all__");
              }}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="class" className="text-xs">Par classe</SelectItem>
                  <SelectItem value="teacher" className="text-xs">Par enseignant</SelectItem>
                  <SelectItem value="room" className="text-xs">Par salle</SelectItem>
                </SelectContent>
              </Select>
              {/* T-409 / SCHED-111: the class projection has a MANDATORY
                  class selector — one class at a time, NO "Tout afficher"
                  option (a class timetable answers "what does THIS class
                  study at each period?"). */}
              {viewMode === "class" && (
                <Select
                  value={classViewEntityId ?? ""}
                  onValueChange={(v) => setViewEntityId(v)}
                >
                  <SelectTrigger className="h-8 w-56 text-xs">
                    <SelectValue placeholder="Classe" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Aucune classe
                      </div>
                    ) : (
                      viewEntities.map((e) => (
                        <SelectItem key={e.id} value={e.id} className="text-xs">
                          {e.label}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
              {viewMode !== "class" && (
                <Select value={viewEntityId} onValueChange={setViewEntityId}>
                  <SelectTrigger className="h-8 w-56 text-xs">
                    <SelectValue placeholder="Tout" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__" className="text-xs">Tout afficher</SelectItem>
                    {viewEntities.map((e) => (
                      <SelectItem key={e.id} value={e.id} className="text-xs">
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() => generate()}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                  Générer
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-12 text-center">
                <CalendarDays className="h-10 w-10 text-muted-foreground opacity-40" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Aucun emploi du temps généré pour {year.code ?? "l'année active"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Configurez les salles et les contraintes, puis lancez la génération
                    automatique (curriculum = heures hebdomadaires des matières par classe).
                  </p>
                </div>
                {canManage && (
                  <Button size="sm" disabled={busy} onClick={() => generate()}>
                    <Plus className="h-3.5 w-3.5" />
                    Générer l'emploi du temps
                  </Button>
                )}
              </div>
            ) : (
              <TimetableGrid
                configuration={configuration}
                entries={entries}
                viewMode={viewMode}
                viewEntityId={
                  viewMode === "class"
                    ? // T-409: the class projection is ALWAYS scoped to the
                      // selected class — never null (never "all classes").
                      classViewEntityId
                    : viewEntityId === "__all__"
                      ? null
                      : viewEntityId
                }
                names={names}
                editable={editable}
                onEntryClick={(e) => editable && setAdjustEntry(e)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ── TRIALS ───────────────────────────────────────────────────── */}
      {subTab === "trials" && (
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <GitBranch className="h-4 w-4 text-primary" />
                Essais de génération ({versions.length})
              </CardTitle>
              {canManage && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={busy}
                    onClick={() => generate()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Nouvel essai
                  </Button>
                  {selectedVersion && selectedVersion.status === "published" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={busy}
                      onClick={() => workflow(selectedVersion, "duplicate")}
                    >
                      Dupliquer en brouillon
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="pb-4">
              {versions.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Aucun essai — lancez une première génération.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {versions.map((v) => {
                    const stats = v.statistics as Record<string, unknown>;
                    const placed = Number(stats?.placedPeriods ?? 0);
                    const required = Number(stats?.requiredPeriods ?? 0);
                    return (
                      <div
                        key={v.id}
                        className={`rounded-md border p-3 ${
                          selectedVersion?.id === v.id
                            ? "border-primary/40 bg-primary/5"
                            : "border-border"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              v{v.versionNumber}
                              {v.label ? ` — ${v.label}` : ""}
                            </span>
                            {statusBadge(v.status)}
                            <span className="text-[10px] text-muted-foreground">
                              solveur {v.solverId} {v.solverBuild ?? ""}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {v.status === "draft" && canManage && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => workflow(v, "submit")}>
                                  Soumettre en révision
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => workflow(v, "reject")}>
                                  Rejeter
                                </Button>
                              </>
                            )}
                            {v.status === "in_review" && canManage && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => workflow(v, "approve")}>
                                  <ShieldCheck className="h-3 w-3" />
                                  Approuver
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => workflow(v, "reject")}>
                                  Rejeter
                                </Button>
                              </>
                            )}
                            {v.status === "approved" && canManage && (
                              <Button size="sm" className="h-7 text-[11px]" disabled={busy} onClick={() => workflow(v, "publish")}>
                                Publier
                              </Button>
                            )}
                            {(v.status === "published" || v.status === "archived" || v.status === "rejected") && canManage && (
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => workflow(v, "duplicate")}>
                                Dupliquer en brouillon
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[11px]"
                              onClick={() => {
                                setSelectedVersionId(v.id);
                                setSubTab("schedule");
                              }}
                            >
                              Examiner
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          <span>
                            {placed}/{required} périodes placées
                          </span>
                          {/* T-409: final COVERAGE — a separate metric from
                              generation progress (a finished computation can
                              legitimately produce an incomplete timetable). */}
                          <span>
                            couverture{" "}
                            {required > 0
                              ? `${timetableCoveragePercent(placed, required)}%`
                              : "—"}
                          </span>
                          {v.unplacedCount > 0 && (
                            <span className="text-status-danger">
                              {v.unplacedCount} bloc(s) non placé(s)
                            </span>
                          )}
                          {v.hardViolationCount > 0 && (
                            <span className="text-status-danger">
                              {v.hardViolationCount} violation(s) stricte(s)
                            </span>
                          )}
                          {v.softViolationCount > 0 && (
                            <span className="text-status-warning">
                              {v.softViolationCount} préférence(s) non respectée(s)
                            </span>
                          )}
                          {v.publishedAt && (
                            <span>publiée le {new Date(v.publishedAt).toLocaleDateString("fr-FR")}</span>
                          )}
                        </div>
                        {(v.unplacedCount > 0 || violationsOf(v).length > 0) && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[11px] font-medium text-primary">
                              Explications des conflits ({violationsOf(v).length + v.unplacedCount})
                            </summary>
                            <ul className="mt-1 flex flex-col gap-1">
                              {violationsOf(v)
                                .slice(0, 50)
                                .map((violation, i) => (
                                  <li
                                    key={i}
                                    className={`rounded border-l-2 px-2 py-1 text-[11px] ${
                                      violation.severity === "hard"
                                        ? "border-status-danger bg-status-danger/5"
                                        : "border-status-warning bg-status-warning/5"
                                    }`}
                                  >
                                    {violation.message}
                                  </li>
                                ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── CONFIGURATION ────────────────────────────────────────────── */}
      {subTab === "configuration" && year.id && (
        <ConfigurationPanel
          configuration={configuration}
          academicYearId={year.id}
          canManage={canManage}
          actor={actor}
          onSaved={(msg) => toasts.showSuccess("Configuration", msg)}
          onError={(msg) => toasts.showError("Configuration", msg)}
        />
      )}

      {/* ── ROOMS ────────────────────────────────────────────────────── */}
      {subTab === "rooms" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <DoorOpen className="h-4 w-4 text-primary" />
              Salles ({rooms.length})
            </CardTitle>
            <RoomCreateButton canManage={canManage} actor={actor} />
          </CardHeader>
          <CardContent className="pb-4">
            {rooms.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Aucune salle configurée — ajoutez les salles de classe, laboratoires
                et ateliers (types + capacités).
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {rooms.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {r.code} — {r.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {ROOM_TYPE_LABELS[r.roomType] ?? r.roomType}
                        {r.capacity != null ? ` · ${r.capacity} places` : ""}
                        {r.building ? ` · Bât. ${r.building}` : ""}
                        {!r.isActive ? " · inactive" : ""}
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-status-danger"
                        onClick={() => setRoomToDelete(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── CONSTRAINTS ──────────────────────────────────────────────── */}
      {subTab === "constraints" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4 text-primary" />
              Contraintes ({constraints.length})
            </CardTitle>
            <ConstraintCreateButton
              canManage={canManage && !!year.id}
              actor={actor}
              academicYearId={year.id ?? ""}
              classes={classes.map((c) => ({ id: c.id, label: c.name ?? c.code }))}
              teachers={personnel
                .filter((p) => p.staffCategory === "teacher")
                .map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}` }))}
              rooms={rooms.map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` }))}
              configuration={configuration}
            />
          </CardHeader>
          <CardContent className="pb-4">
            {constraints.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Aucune contrainte — ajoutez les jours libres, indisponibilités et
                préférences (classes, enseignants, salles).
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {constraints.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge
                        variant={c.severity === "hard" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {c.severity === "hard" ? "Stricte" : "Préférence"}
                      </Badge>
                      <span className="text-xs font-medium text-foreground">
                        {CONSTRAINT_KIND_LABELS[c.kind] ?? c.kind}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {constraintDescription(c, names)}
                      </span>
                      {!c.isActive && <span className="text-[10px] text-muted-foreground">(inactive)</span>}
                    </div>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-status-danger"
                        onClick={() => setConstraintToDelete(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────── */}
      {adjustEntry && (
        <TimetableEntryDialog
          entry={adjustEntry}
          configuration={configuration}
          version={selectedVersion}
          rooms={rooms}
          names={names}
          actor={actor}
          onClose={() => setAdjustEntry(null)}
        />
      )}

      <ConfirmModal
        open={roomToDelete != null}
        title="Supprimer la salle ?"
        description={
          roomToDelete
            ? `La salle « ${roomToDelete.code} — ${roomToDelete.name} » sera retirée du catalogue. Les cours affectés perdront leur salle.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!roomToDelete) return;
          const result = await repos.timetable.deleteRoom(roomToDelete.id, actor);
          if (!result.ok) {
            toasts.showError("Suppression impossible", result.error.message);
          }
          setRoomToDelete(null);
        }}
        onOpenChange={(open) => !open && setRoomToDelete(null)}
      />

      <ConfirmModal
        open={constraintToDelete != null}
        title="Supprimer la contrainte ?"
        description={
          constraintToDelete
            ? `La contrainte « ${CONSTRAINT_KIND_LABELS[constraintToDelete.kind] ?? constraintToDelete.kind} » sera supprimée.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!constraintToDelete) return;
          const result = await repos.timetable.deleteConstraint(
            constraintToDelete.id,
            actor,
          );
          if (!result.ok) {
            toasts.showError("Suppression impossible", result.error.message);
          }
          setConstraintToDelete(null);
        }}
        onOpenChange={(open) => !open && setConstraintToDelete(null)}
      />
    </div>
  );
}

// ============================================================================
// Constraint description helper
// ============================================================================

function constraintDescription(
  c: TimetableConstraint,
  names: {
    classes: ReadonlyMap<string, string>;
    teachers: ReadonlyMap<string, string>;
    rooms: ReadonlyMap<string, string>;
  },
): string {
  const scopeLabel =
    c.scope === "school"
      ? "tout l'établissement"
      : c.scope === "class"
        ? (names.classes.get(c.entityId ?? "") ?? "classe ?")
        : c.scope === "teacher"
          ? (names.teachers.get(c.entityId ?? "") ?? "enseignant ?")
          : (names.rooms.get(c.entityId ?? "") ?? "salle ?");
  const params = c.params as Record<string, unknown>;
  const day =
    typeof params.day === "string" &&
    Object.keys(TIMETABLE_DAY_LABELS_FR).includes(params.day)
      ? TIMETABLE_DAY_LABELS_FR[params.day as TimetableDay]
      : null;
  const period = typeof params.periodIndex === "number" ? `p${params.periodIndex}` : null;
  const max = typeof params.max === "number" ? `max ${params.max}` : null;
  const parts = [scopeLabel, day, period, max].filter(Boolean);
  return parts.join(" · ");
}

// ============================================================================
// Room creation (compact inline form)
// ============================================================================

function RoomCreateButton({
  canManage,
  actor,
}: {
  canManage: boolean;
  actor: ActorContext;
}) {
  const repos = useRepositories();
  const toasts = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [roomType, setRoomType] = useState<string>("classroom");
  const [capacity, setCapacity] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canManage) return null;

  async function submit(): Promise<void> {
    if (code.trim() === "" || name.trim() === "") return;
    setBusy(true);
    try {
      const result = await repos.timetable.createRoom(
        {
          code: code.trim(),
          name: name.trim(),
          roomType: roomType as Room["roomType"],
          capacity: capacity.trim() === "" ? null : Number(capacity),
        },
        actor,
      );
      if (result.ok) {
        toasts.showSuccess("Salle ajoutée", `${result.value.code} — ${result.value.name}`);
        setOpen(false);
        setCode("");
        setName("");
        setCapacity("");
      } else {
        toasts.showError("Ajout impossible", result.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Ajouter une salle
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface-panel p-5 shadow-xl">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Nouvelle salle</h3>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  Code
                  <input
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    placeholder="SAL-04"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Capacité
                  <input
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    placeholder="30"
                    inputMode="numeric"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                Nom
                <input
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  placeholder="Salle 04 — Bâtiment A"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Type
                <select
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  value={roomType}
                  onChange={(e) => setRoomType(e.target.value)}
                >
                  {ROOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ROOM_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void submit()}>
                Ajouter
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Constraint creation (compact inline form)
// ============================================================================

function ConstraintCreateButton({
  canManage,
  actor,
  academicYearId,
  classes,
  teachers,
  rooms,
  configuration,
}: {
  canManage: boolean;
  actor: ActorContext;
  academicYearId: string;
  classes: Array<{ id: string; label: string }>;
  teachers: Array<{ id: string; label: string }>;
  rooms: Array<{ id: string; label: string }>;
  configuration: import("../../../domain/model/timetable").TimetableConfiguration | null;
}) {
  const repos = useRepositories();
  const toasts = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>("class");
  const [entityId, setEntityId] = useState<string>("");
  const [kind, setKind] = useState<string>("free_day");
  const [severity, setSeverity] = useState<string>("hard");
  const [day, setDay] = useState<string>("sunday");
  const [periodIndex, setPeriodIndex] = useState<string>("1");
  const [max, setMax] = useState<string>("6");
  const [busy, setBusy] = useState(false);

  if (!canManage) return null;

  const entities = scope === "class" ? classes : scope === "teacher" ? teachers : rooms;
  const needsEntity = scope !== "school";
  const needsDay = kind === "free_day" || kind === "unavailable_period";
  const needsPeriod = kind === "unavailable_period" || kind === "preferred_period";
  const needsMax =
    kind === "max_daily_lessons" ||
    kind === "max_weekly_hours" ||
    kind === "max_consecutive";

  async function submit(): Promise<void> {
    const params: Record<string, unknown> = {};
    if (needsDay) params.day = day;
    if (needsPeriod) params.periodIndex = Number(periodIndex);
    if (needsMax) params.max = Number(max);
    setBusy(true);
    try {
      const result = await repos.timetable.createConstraint(
        {
          academicYearId,
          scope: scope as TimetableConstraint["scope"],
          entityId: needsEntity ? entityId || null : null,
          kind: kind as TimetableConstraint["kind"],
          severity: severity === "soft" ? "soft" : "hard",
          params,
        },
        actor,
      );
      if (result.ok) {
        toasts.showSuccess("Contrainte ajoutée", CONSTRAINT_KIND_LABELS[kind] ?? kind);
        setOpen(false);
      } else {
        toasts.showError("Ajout impossible", result.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Ajouter une contrainte
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface-panel p-5 shadow-xl">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Nouvelle contrainte</h3>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  Portée
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value);
                      setEntityId("");
                    }}
                  >
                    <option value="school">Établissement</option>
                    <option value="class">Classe</option>
                    <option value="teacher">Enseignant</option>
                    <option value="room">Salle</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Type
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    {TIMETABLE_CONSTRAINT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {CONSTRAINT_KIND_LABELS[k] ?? k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {needsEntity && (
                <label className="flex flex-col gap-1 text-xs">
                  {scope === "class" ? "Classe" : scope === "teacher" ? "Enseignant" : "Salle"}
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}
                  >
                    <option value="">— Choisir —</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs">
                Sévérité
                <select
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  <option value="hard">Stricte (jamais violée)</option>
                  <option value="soft">Préférence (signalée si violée)</option>
                </select>
              </label>
              {needsDay && (
                <label className="flex flex-col gap-1 text-xs">
                  Jour
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  >
                    {(configuration?.schoolDays ?? (Object.keys(TIMETABLE_DAY_LABELS_FR) as TimetableDay[])).map((d) => (
                      <option key={d} value={d}>
                        {TIMETABLE_DAY_LABELS_FR[d]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {needsPeriod && (
                <label className="flex flex-col gap-1 text-xs">
                  Période
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    value={periodIndex}
                    onChange={(e) => setPeriodIndex(e.target.value)}
                  >
                    {(configuration?.periods ?? []).map((p) => (
                      <option key={p.index} value={String(p.index)}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {needsMax && (
                <label className="flex flex-col gap-1 text-xs">
                  Maximum
                  <input
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    inputMode="numeric"
                    value={max}
                    onChange={(e) => setMax(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={busy || (needsEntity && entityId === "")}
                onClick={() => void submit()}
              >
                Ajouter
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Configuration panel (school week / periods / breaks)
// ============================================================================

function ConfigurationPanel({
  configuration,
  academicYearId,
  canManage,
  actor,
  onSaved,
  onError,
}: {
  configuration: import("../../../domain/model/timetable").TimetableConfiguration | null;
  academicYearId: string;
  canManage: boolean;
  actor: ActorContext;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const repos = useRepositories();
  const [label, setLabel] = useState(configuration?.label ?? "");
  const [selectedDays, setSelectedDays] = useState<string[]>(
    configuration?.schoolDays != null ? [...configuration.schoolDays] : [],
  );
  const [firstHour, setFirstHour] = useState("08:00");
  const [periodCount, setPeriodCount] = useState("6");
  const [periodMinutes, setPeriodMinutes] = useState("60");
  const [afternoonStart, setAfternoonStart] = useState("13:00");
  const [busy, setBusy] = useState(false);

  // Sync when the loaded configuration arrives/changes.
  const [syncedId, setSyncedId] = useState<string | null>(null);
  if (configuration && configuration.id !== syncedId) {
    setSyncedId(configuration.id);
    setLabel(configuration.label);
    setSelectedDays([...configuration.schoolDays]);
    setPeriodCount(String(configuration.periods.length));
    setPeriodMinutes(String(configuration.periods[0]?.endMinutes != null
      ? configuration.periods[0].endMinutes - configuration.periods[0].startMinutes
      : 60));
    setFirstHour(
      `${String(Math.floor((configuration.periods[0]?.startMinutes ?? 480) / 60)).padStart(2, "0")}:${String(
        (configuration.periods[0]?.startMinutes ?? 480) % 60,
      ).padStart(2, "0")}`,
    );
    const afternoonPeriod = configuration.periods.find(
      (p) => p.startMinutes >= 12 * 60,
    );
    setAfternoonStart(
      afternoonPeriod
        ? `${String(Math.floor(afternoonPeriod.startMinutes / 60)).padStart(2, "0")}:${String(
            afternoonPeriod.startMinutes % 60,
          ).padStart(2, "0")}`
        : "13:00",
    );
  }

  function parseHhmm(value: string): number {
    const [h, m] = value.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  async function save(): Promise<void> {
    const days = selectedDays.filter((d): d is TimetableDay =>
      Object.keys(TIMETABLE_DAY_LABELS_FR).includes(d),
    );
    if (days.length === 0) {
      onError("Sélectionnez au moins un jour d'école.");
      return;
    }
    const count = Math.max(1, Math.min(12, Number(periodCount) || 6));
    const minutes = Math.max(30, Math.min(120, Number(periodMinutes) || 60));
    const start = parseHhmm(firstHour);
    const afternoon = parseHhmm(afternoonStart);

    // Morning periods until lunch (12:15), afternoon after 13:00 — with a
    // 15-min mid-morning break after the 2nd period (the Algerian shape).
    const periods: Array<{
      index: number;
      label: string;
      startMinutes: number;
      endMinutes: number;
    }> = [];
    let cursor = start;
    let index = 1;
    let morningCount = 0;
    while (index <= count) {
      if (cursor >= 12 * 60 + 15 && cursor < afternoon) {
        cursor = afternoon; // jump the lunch break
      }
      periods.push({
        index,
        label: `S${index}`,
        startMinutes: cursor,
        endMinutes: cursor + minutes,
      });
      cursor += minutes;
      morningCount += 1;
      if (morningCount === 2 && index < count) {
        cursor += 15; // mid-morning break after S2
      }
      index += 1;
    }
    const breaks: Array<{ afterPeriodIndex: number; label: string; startMinutes: number; endMinutes: number }> = [];
    const s2 = periods[1];
    if (s2 && periods[2]) {
      breaks.push({
        afterPeriodIndex: 2,
        label: "Pause",
        startMinutes: s2.endMinutes,
        endMinutes: periods[2].startMinutes,
      });
    }
    const lunchBoundary = periods.find(
      (p, i) => i > 0 && p.startMinutes >= periods[i - 1].endMinutes + 30,
    );
    if (lunchBoundary) {
      const prev = periods[periods.indexOf(lunchBoundary) - 1];
      breaks.push({
        afterPeriodIndex: prev.index,
        label: "Déjeuner",
        startMinutes: prev.endMinutes,
        endMinutes: lunchBoundary.startMinutes,
      });
    }

    setBusy(true);
    try {
      const result = await repos.timetable.saveConfiguration(
        {
          academicYearId,
          label: label.trim() || "Configuration emploi du temps",
          schoolDays: days,
          periods,
          breaks,
          defaultLessonMinutes: minutes,
          maxPeriodsPerDay: count,
        },
        actor,
      );
      if (result.ok) {
        onSaved(`Semaine ${result.value.schoolDays.length} jours × ${result.value.periods.length} périodes enregistrée.`);
      } else {
        onError(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const allDays = Object.keys(TIMETABLE_DAY_LABELS_FR);

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings2 className="h-4 w-4 text-primary" />
          Configuration de la semaine scolaire
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-4">
        <p className="text-xs text-muted-foreground">
          Le profil algérien standard (dimanche→jeudi, 6 périodes de 08:00 à 15:00)
          est pré-chargé comme donnée — ajustez selon votre établissement.
        </p>
        <label className="flex flex-col gap-1 text-xs">
          Libellé
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            value={label}
            disabled={!canManage}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground">Jours d'école</p>
          <div className="flex flex-wrap gap-1.5">
            {allDays.map((d) => {
              const active = selectedDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!canManage}
                  onClick={() =>
                    setSelectedDays((prev) =>
                      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                    )
                  }
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {TIMETABLE_DAY_LABELS_FR[d as TimetableDay]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            1re période
            <input
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              value={firstHour}
              disabled={!canManage}
              onChange={(e) => setFirstHour(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Nb périodes / jour
            <input
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              inputMode="numeric"
              value={periodCount}
              disabled={!canManage}
              onChange={(e) => setPeriodCount(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Durée période (min)
            <input
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              inputMode="numeric"
              value={periodMinutes}
              disabled={!canManage}
              onChange={(e) => setPeriodMinutes(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Reprise après-midi
            <input
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              value={afternoonStart}
              disabled={!canManage}
              onChange={(e) => setAfternoonStart(e.target.value)}
            />
          </label>
        </div>
        {canManage && (
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void save()}>
              Enregistrer la configuration
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
