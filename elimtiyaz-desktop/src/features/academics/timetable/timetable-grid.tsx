// ============================================================================
// FILE: src/features/academics/timetable/timetable-grid.tsx
// ============================================================================
/**
 * The canonical Timetable / Emploi du temps grid — T-404.
 *
 * ONE grid component renders the SAME canonical schedule from three
 * projections: by class (the primary staff view), by teacher, and by room.
 * No view-specific schedule stores — every projection reads the same
 * TimetableScheduleEntry rows (ADR-020 §8: "Class, teacher and room
 * timetable views are projections of the same canonical schedule").
 *
 * Manual adjustment: clicking a cell opens the adjustment dialog with LIVE
 * validation feedback (the repository's canonical engine).
 */

import { useMemo } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { cn } from "../../../shared/ui/cn";
import type {
  TimetableConfiguration,
  TimetableDay,
  TimetableScheduleEntry,
} from "../../../domain/model/timetable";
import { TIMETABLE_DAY_LABELS_FR } from "../../../domain/model/timetable";

export type TimetableViewMode = "class" | "teacher" | "room";

export interface TimetableGridProps {
  readonly configuration: TimetableConfiguration | null;
  readonly entries: readonly TimetableScheduleEntry[];
  readonly viewMode: TimetableViewMode;
  /** The selected class/teacher/room id for the projection (null = all). */
  readonly viewEntityId: string | null;
  readonly names: {
    readonly classes: ReadonlyMap<string, string>;
    readonly subjects: ReadonlyMap<string, string>;
    readonly teachers: ReadonlyMap<string, string>;
    readonly rooms: ReadonlyMap<string, string>;
  };
  readonly editable: boolean;
  readonly onEntryClick?: (entry: TimetableScheduleEntry) => void;
}

/** Deterministic pastel palette per subject id (stable across renders). */
function subjectHue(subjectId: string): string {
  let h = 0;
  for (let i = 0; i < subjectId.length; i++) {
    h = (h * 31 + subjectId.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 60% 88%)`;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

export function TimetableGrid({
  configuration,
  entries,
  viewMode,
  viewEntityId,
  names,
  editable,
  onEntryClick,
}: TimetableGridProps) {
  const days = useMemo<TimetableDay[]>(
    () => (configuration ? [...configuration.schoolDays] : []),
    [configuration],
  );
  const periods = useMemo(
    () =>
      configuration
        ? [...configuration.periods].sort((a, b) => a.index - b.index)
        : [],
    [configuration],
  );

  const projected = useMemo(() => {
    if (!viewEntityId) return entries;
    switch (viewMode) {
      case "class":
        return entries.filter((e) => e.classId === viewEntityId);
      case "teacher":
        return entries.filter((e) => e.teacherId === viewEntityId);
      case "room":
        return entries.filter((e) => e.roomId === viewEntityId);
    }
  }, [entries, viewMode, viewEntityId]);

  const cellEntries = useMemo(() => {
    const map = new Map<string, TimetableScheduleEntry>();
    for (const e of projected) {
      map.set(`${e.day}#${e.periodIndex}`, e);
    }
    return map;
  }, [projected]);

  if (!configuration || periods.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-10 text-center">
        <CalendarDays className="h-8 w-8 text-muted-foreground opacity-50" />
        <p className="text-sm font-medium text-foreground">
          Aucune configuration active
        </p>
        <p className="text-xs text-muted-foreground">
          Définissez les jours d'école et les périodes dans l'onglet Configuration.
        </p>
      </div>
    );
  }

  const label = (entry: TimetableScheduleEntry): string => {
    const subject = names.subjects.get(entry.subjectId) ?? "Matière";
    if (viewMode === "class") return subject;
    const cls = names.classes.get(entry.classId) ?? "Classe";
    return `${subject} · ${cls}`;
  };
  const subLabel = (entry: TimetableScheduleEntry): string => {
    const teacher = entry.teacherId
      ? (names.teachers.get(entry.teacherId) ?? "—")
      : "—";
    const room = entry.roomId ? (names.rooms.get(entry.roomId) ?? "—") : "—";
    if (viewMode === "class") return `${teacher} · ${room}`;
    if (viewMode === "teacher") return room;
    return teacher;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-24 border-b border-border bg-surface-panel px-2 py-2 text-left font-medium text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Période
              </div>
            </th>
            {days.map((day) => (
              <th
                key={day}
                className="border-b border-l border-border bg-surface-panel px-2 py-2 text-left font-medium text-muted-foreground"
              >
                {TIMETABLE_DAY_LABELS_FR[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period.index} className="align-top">
              <td className="sticky left-0 z-10 border-b border-border bg-surface-panel px-2 py-2">
                <div className="font-medium text-foreground">{period.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {hhmm(period.startMinutes)}–{hhmm(period.endMinutes)}
                </div>
              </td>
              {days.map((day) => {
                const entry = cellEntries.get(`${day}#${period.index}`);
                const breakAfter = configuration.breaks.find(
                  (b) => b.afterPeriodIndex === period.index,
                );
                return (
                  <td
                    key={`${day}-${period.index}`}
                    className="border-b border-l border-border p-1 min-w-[120px]"
                  >
                    {entry ? (
                      <button
                        type="button"
                        onClick={() => onEntryClick?.(entry)}
                        className={cn(
                          "flex min-h-[52px] w-full flex-col justify-center gap-0.5 rounded-md border px-2 py-1 text-left transition-colors",
                          editable
                            ? "cursor-pointer border-transparent hover:border-primary/40"
                            : "cursor-default border-transparent",
                        )}
                        style={{ backgroundColor: subjectHue(entry.subjectId) }}
                        title={`${label(entry)} — ${subLabel(entry)}${
                          entry.isLocked ? " (épinglé)" : ""
                        }`}
                      >
                        <span className="truncate text-[11px] font-semibold text-foreground">
                          {label(entry)}
                          {entry.isLocked ? " *" : ""}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {subLabel(entry)}
                        </span>
                      </button>
                    ) : (
                      <div className="flex min-h-[52px] w-full items-center justify-center text-[10px] text-muted-foreground/40">
                        —
                      </div>
                    )}
                    {breakAfter && (
                      <div className="pt-0.5 text-center text-[9px] italic text-muted-foreground/60">
                        {breakAfter.label}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-muted-foreground">
        * = épinglé (conservé à la régénération) — cliquez un cours pour
        l'ajuster (brouillons uniquement).
      </div>
    </div>
  );
}
