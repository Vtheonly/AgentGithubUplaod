// ============================================================================
// FILE: src/features/academics/timetable/timetable-entry-dialog.tsx
// ============================================================================
/**
 * Manual timetable adjustment dialog — T-404.
 *
 * Live validation: every change re-checks the candidate schedule through
 * the repository (the canonical engine) BEFORE the write; hard conflicts
 * (teacher/class/room double-booking, free days, room types, capacities)
 * block the save with the French explanation from the violation report.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Lock, Pin, PinOff, Trash2 } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { Button } from "../../../shared/ui/button";
import { ConfirmModal } from "../../../shared/ui/unified-modal";
import type {
  Room,
  TimetableConfiguration,
  TimetableDay,
  TimetableScheduleEntry,
  TimetableVersion,
} from "../../../domain/model/timetable";
import {
  TIMETABLE_CONSTRAINT_KINDS,
  TIMETABLE_DAY_LABELS_FR,
} from "../../../domain/model/timetable";
import type { ActorContext } from "../../../domain/repository/timetable-repository";

export interface TimetableEntryDialogProps {
  readonly entry: TimetableScheduleEntry;
  readonly configuration: TimetableConfiguration | null;
  readonly version: TimetableVersion | null;
  readonly rooms: readonly Room[];
  readonly names: {
    readonly classes: ReadonlyMap<string, string>;
    readonly subjects: ReadonlyMap<string, string>;
    readonly teachers: ReadonlyMap<string, string>;
  };
  readonly actor: ActorContext;
  readonly onClose: () => void;
}

export function TimetableEntryDialog({
  entry,
  configuration,
  version,
  rooms,
  names,
  actor,
  onClose,
}: TimetableEntryDialogProps) {
  const repos = useRepositories();
  const toasts = useToast();
  const [day, setDay] = useState<TimetableDay>(entry.day);
  const [periodIndex, setPeriodIndex] = useState<number>(entry.periodIndex);
  const [roomId, setRoomId] = useState<string>(entry.roomId ?? "");
  const [teacherId, setTeacherId] = useState<string>(entry.teacherId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const days = useMemo(
    () => (configuration ? [...configuration.schoolDays] : [entry.day]),
    [configuration, entry.day],
  );
  const periods = useMemo(
    () =>
      configuration
        ? [...configuration.periods].sort((a, b) => a.index - b.index)
        : [{ index: entry.periodIndex, label: `p${entry.periodIndex}`, startMinutes: 0, endMinutes: 0 }],
    [configuration, entry.periodIndex],
  );

  const subjectLabel = names.subjects.get(entry.subjectId) ?? "Matière";
  const classLabel = names.classes.get(entry.classId) ?? "Classe";

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await repos.timetable.moveEntry(
        entry.id,
        {
          day,
          periodIndex,
          roomId: roomId === "" ? null : roomId,
          teacherId: teacherId === "" ? null : teacherId,
        },
        actor,
      );
      if (result.ok) {
        toasts.showSuccess("Cours ajusté", `${subjectLabel} déplacé (${TIMETABLE_DAY_LABELS_FR[day]} p${periodIndex}) — validé sans conflit.`);
        onClose();
      } else {
        // LIVE VALIDATION feedback — the canonical engine's explanation.
        setError(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock(): Promise<void> {
    setBusy(true);
    try {
      const result = await repos.timetable.setEntryLocked(entry.id, !entry.isLocked, actor);
      if (result.ok) {
        toasts.showSuccess(
          result.value.isLocked ? "Cours épinglé" : "Épingle retirée",
          result.value.isLocked
            ? "Ce créneau sera conservé lors des régénérations."
            : "Ce créneau pourra être repositionné lors des régénérations.",
        );
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      const result = await repos.timetable.deleteEntry(entry.id, actor);
      if (result.ok) {
        toasts.showSuccess("Cours supprimé");
        onClose();
      } else {
        setError(result.error.message);
      }
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface-panel p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-foreground">
          Ajuster le cours — {subjectLabel}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {classLabel} · {version ? `v${version.versionNumber}` : ""} ·{" "}
          {entry.source === "manual" ? "ajusté manuellement" : "généré"}
          {entry.isLocked ? " · épinglé" : ""}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            Jour
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              value={day}
              onChange={(e) => setDay(e.target.value as TimetableDay)}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {TIMETABLE_DAY_LABELS_FR[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Période
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              value={String(periodIndex)}
              onChange={(e) => setPeriodIndex(Number(e.target.value))}
            >
              {periods.map((p) => (
                <option key={p.index} value={String(p.index)}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Enseignant
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              <option value="">— Non affecté —</option>
              {[...names.teachers.entries()].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Salle
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <option value="">— Aucune —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 p-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-danger" />
            <div className="text-[11px] text-status-danger">
              <p className="font-medium">Conflit détecté — validation en direct :</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={busy}
              onClick={() => void toggleLock()}
            >
              {entry.isLocked ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              {entry.isLocked ? "Détacher" : "Épingler"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-status-danger"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onClose}>
              Annuler
            </Button>
            <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void save()}>
              <Lock className="h-3.5 w-3.5" />
              Valider l'ajustement
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Supprimer ce cours ?"
        description={`Le cours de ${subjectLabel} (${TIMETABLE_DAY_LABELS_FR[day]} p${periodIndex}) sera retiré de la grille.`}
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => void remove()}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
      />
    </div>
  );
}

// Keep the constraint kinds import referenced (the dialog is part of the
// constraints-aware surface; TIMETABLE_CONSTRAINT_KINDS documents the v1
// contract this dialog's free-day/unavailability messages align with).
void TIMETABLE_CONSTRAINT_KINDS;
