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
 * T-409 / SCHED-111 — CLASS-FIRST rendering contract:
 *   - The class view is filtered STRICTLY by the selected `classId`; a
 *     null entity in class mode renders the honest empty state, NEVER
 *     the flattened multi-class grid (the old defect returned ALL
 *     entries when no entity was selected).
 *   - A visual schedule position is contextual: (class A, day, period)
 *     and (class B, day, period) are DIFFERENT positions. Cells hold a
 *     LIST of entries — concurrent lessons stack, nothing is silently
 *     overwritten (the old single-entry Map kept only the LAST entry).
 *     In the class projection the strict classId filter guarantees a
 *     single-class weekly grid; teacher/room projections keep their
 *     "Tout afficher" option with honest stacking.
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

/**
 * High-contrast subject palette.
 *
 * Keep the mapping deterministic so the same subject keeps the same visual
 * identity across renders and across the class/teacher/room projections.
 * Each swatch carries its own readable foreground/border instead of relying
 * on the global muted text color, which was too low-contrast on pastel cards.
 */
type SubjectColor = Readonly<{
  background: string;
  foreground: string;
  border: string;
}>;

const SUBJECT_COLORS: readonly SubjectColor[] = [
  { background: "#dbeafe", foreground: "#1e3a8a", border: "#93c5fd" },
  { background: "#ccfbf1", foreground: "#115e59", border: "#5eead4" },
  { background: "#dcfce7", foreground: "#166534", border: "#86efac" },
  { background: "#fef3c7", foreground: "#92400e", border: "#fcd34d" },
  { background: "#ffedd5", foreground: "#9a3412", border: "#fdba74" },
  { background: "#fee2e2", foreground: "#991b1b", border: "#fca5a5" },
  { background: "#fce7f3", foreground: "#9d174d", border: "#f9a8d4" },
  { background: "#ede9fe", foreground: "#5b21b6", border: "#c4b5fd" },
  { background: "#e0e7ff", foreground: "#3730a3", border: "#a5b4fc" },
  { background: "#cffafe", foreground: "#155e75", border: "#67e8f9" },
  { background: "#ecfccb", foreground: "#3f6212", border: "#bef264" },
  { background: "#f3e8ff", foreground: "#6b21a8", border: "#d8b4fe" },
  { background: "#e2e8f0", foreground: "#334155", border: "#94a3b8" },
  { background: "#d1fae5", foreground: "#065f46", border: "#6ee7b7" },
  { background: "#fae8ff", foreground: "#86198f", border: "#e879f9" },
  { background: "#fef9c3", foreground: "#854d0e", border: "#fde047" },
  { background: "#dbeafe", foreground: "#1e40af", border: "#60a5fa" },
  { background: "#ccfbf1", foreground: "#134e4a", border: "#2dd4bf" },
] as const;

function subjectColor(subjectId: string): SubjectColor {
  let hash = 0;
  for (let i = 0; i < subjectId.length; i++) {
    hash = (hash * 31 + subjectId.charCodeAt(i)) >>> 0;
  }
  return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
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
    // T-409 / SCHED-111: the class view is ALWAYS scoped to ONE class. A
    // null entity in class mode is the honest EMPTY projection — never
    // "every class at once" (the old `!viewEntityId → return entries`
    // fallback was the cross-class overwrite root cause).
    switch (viewMode) {
      case "class":
        return viewEntityId
          ? entries.filter((e) => e.classId === viewEntityId)
          : [];
      case "teacher":
        return viewEntityId
          ? entries.filter((e) => e.teacherId === viewEntityId)
          : entries;
      case "room":
        return viewEntityId
          ? entries.filter((e) => e.roomId === viewEntityId)
          : entries;
    }
  }, [entries, viewMode, viewEntityId]);

  // T-409 / SCHED-111: a visual cell holds a LIST of entries — entries
  // APPEND, they can never overwrite one another. In the class projection
  // the strict filter above guarantees at most ONE lesson per (day,
  // period) — a class's weekly grid; in the teacher/room "Tout afficher"
  // projection, concurrent lessons stack instead of the old behaviour
  // where the LAST entry silently replaced every earlier one.
  const cellEntries = useMemo(() => {
    const map = new Map<string, TimetableScheduleEntry[]>();
    for (const e of projected) {
      const key = `${e.day}#${e.periodIndex}`;
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
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

  // T-409: the class projection without a selected class renders the
  // honest empty state — the mixed all-classes grid is NEVER shown.
  if (viewMode === "class" && !viewEntityId) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-10 text-center">
        <CalendarDays className="h-8 w-8 text-muted-foreground opacity-50" />
        <p className="text-sm font-medium text-foreground">
          Sélectionnez une classe
        </p>
        <p className="text-xs text-muted-foreground">
          L'emploi du temps par classe affiche une classe à la fois — choisissez
          une classe pour afficher son emploi du temps hebdomadaire complet.
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
                const cell = cellEntries.get(`${day}#${period.index}`);
                const breakAfter = configuration.breaks.find(
                  (b) => b.afterPeriodIndex === period.index,
                );
                return (
                  <td
                    key={`${day}-${period.index}`}
                    className="border-b border-l border-border p-1 min-w-[120px]"
                  >
                    {cell && cell.length > 0 ? (() => {
                      return (
                        <div className="flex flex-col gap-1">
                          {cell.map((entry) => {
                            const colors = subjectColor(entry.subjectId);
                            return (
                              <button
                                key={`${entry.id}-${entry.lessonGroup}`}
                                type="button"
                                onClick={() => onEntryClick?.(entry)}
                                className={cn(
                                  "flex min-h-[52px] w-full flex-col justify-center gap-0.5 rounded-md border px-2 py-1 text-left transition-[filter,box-shadow]",
                                  editable
                                    ? "cursor-pointer hover:brightness-95 hover:shadow-sm"
                                    : "cursor-default",
                                )}
                                style={{
                                  backgroundColor: colors.background,
                                  color: colors.foreground,
                                  borderColor: colors.border,
                                }}
                                title={`${label(entry)} — ${subLabel(entry)}${entry.isLocked ? " (épinglé)" : ""}`}
                              >
                                <span className="truncate text-[11px] font-semibold text-inherit">
                                  {label(entry)}
                                  {entry.isLocked ? " *" : ""}
                                </span>
                                <span className="truncate text-[10px] font-medium text-inherit opacity-80">
                                  {subLabel(entry)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })() : (
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
