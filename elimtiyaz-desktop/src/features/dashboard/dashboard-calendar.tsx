// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/dashboard-calendar.tsx
// ============================================================================

/**
 * DashboardCalendar — Embedded operational calendar with unified
 * month-grid and daily activity tracker.
 */

import { useState, useMemo, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Wallet,
  ScrollText,
  Receipt,
  Phone,
  Bell,
  Users,
  Calendar as CalendarIcon,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { ScrollArea } from "../../shared/ui/scroll-area";
import { StatusChip } from "../../shared/ui/status-chip";
import { CalendarEventCreatorModal } from "./calendar-event-creator-modal";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import {
  CALENDAR_EVENT_KIND_LABELS_FR,
  type CalendarEvent,
  type CalendarEventKind,
} from "../../domain/model/calendar";
import {
  ALERT_PRIORITY_TONE,
  ALERT_PRIORITY_LABELS_FR,
} from "../../domain/model/operations";
import { formatDzdPlain } from "../../core/format/currency";

const WEEKDAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/**
 * Local calendar date key (YYYY-MM-DD).
 * `Date.prototype.toISOString()` is UTC-based: in Algeria (UTC+1) every date
 * built between 00:00 and 01:00 local lands on the PREVIOUS day, which made the
 * "today" highlight and the initial selection drift. Never use it for a
 * calendar cell.
 */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface MonthSheetCell {
  /** ISO date (YYYY-MM-DD) this cell points at. */
  readonly date: string;
  /** Day number to display — may belong to the previous/next month. */
  readonly day: number;
  /** False = leading/trailing day borrowed from the adjacent month. */
  readonly inMonth: boolean;
}

/**
 * Build the visible sheet of a month calendar: a FIXED 6-week (42 cell),
 * Monday-first grid.
 *
 * Adjacent-month days are rendered (dimmed) instead of leaving blank voids, so
 * the widget reads like an actual month calendar and its height never jumps
 * between 5 and 6 rows while paging through months.
 */
export function buildMonthSheet(year: number, month: number): MonthSheetCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  // getDay() is Sunday=0 → shift so Monday=0 (WEEKDAYS_FR starts on Monday).
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const cells: MonthSheetCell[] = [];

  for (let back = startOffset; back > 0; back--) {
    const d = new Date(year, month, 1 - back);
    cells.push({ date: toDateKey(d), day: d.getDate(), inMonth: false });
  }
  for (let day = 1; day <= lastOfMonth.getDate(); day++) {
    cells.push({
      date: toDateKey(new Date(year, month, day)),
      day,
      inMonth: true,
    });
  }
  let trailingDay = 1;
  while (cells.length < 42) {
    const d = new Date(year, month + 1, trailingDay++);
    cells.push({ date: toDateKey(d), day: d.getDate(), inMonth: false });
  }
  return cells;
}

const KIND_ICONS: Record<CalendarEventKind, typeof Wallet> = {
  payment_received: Wallet,
  audit_log: ScrollText,
  expense_event: Receipt,
  follow_up_call: Phone,
  reminder: Bell,
  meeting: Users,
  custom: CalendarIcon,
};

const KIND_TONES: Record<
  CalendarEventKind,
  "success" | "neutral" | "info" | "warning" | "danger"
> = {
  payment_received: "success",
  audit_log: "neutral",
  expense_event: "info",
  follow_up_call: "warning",
  reminder: "info",
  meeting: "neutral",
  custom: "neutral",
};

export function DashboardCalendar() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const today = new Date();
  const todayKey = toDateKey(today);
  const [cursor, setCursor] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(today));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [monthEventCounts, setMonthEventCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);

  const yearMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;

  useEffect(() => {
    // The sheet always shows leading/trailing days from the adjacent months, so
    // the day-dot counters must cover those months too — otherwise a day from
    // the previous/next month silently renders as "no activity".
    const monthKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const visibleMonths = [
      monthKey(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)),
      yearMonth,
      monthKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)),
    ];
    const countsByMonth = new Map<string, Map<string, number>>();
    const unsubs: Array<() => void> = [];

    const publish = () => {
      const merged = new Map<string, number>();
      for (const perDay of countsByMonth.values()) {
        for (const [date, count] of perDay) {
          merged.set(date, (merged.get(date) ?? 0) + count);
        }
      }
      setMonthEventCounts(merged);
    };

    for (const month of visibleMonths) {
      unsubs.push(
        repos.calendar.observeForMonth(month).subscribe((monthEvents) => {
          const counts = new Map<string, number>();
          for (const e of monthEvents) {
            counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
          }
          countsByMonth.set(month, counts);
          publish();
        }),
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [repos.calendar, yearMonth, cursor]);

  useEffect(() => {
    const unsub = repos.calendar
      .observeForDate(selectedDate)
      .subscribe((dayEvents) => {
        setEvents(dayEvents);
      });
    return unsub;
  }, [repos.calendar, selectedDate]);

  const monthGrid = useMemo(
    () => buildMonthSheet(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  function prevMonth() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  }
  function goToToday() {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(toDateKey(now));
  }
  /** Selecting a borrowed (adjacent-month) day pages the calendar to it. */
  function selectDate(date: string) {
    setSelectedDate(date);
    const [year, month] = date.split("-").map(Number);
    if (year !== cursor.getFullYear() || month - 1 !== cursor.getMonth()) {
      setCursor(new Date(year, month - 1, 1));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await repos.calendar.delete(deleteTarget.id);
    if (result.ok) {
      toast.showSuccess(
        "Événement supprimé",
        `« ${deleteTarget.title} » a été retiré.`,
      );
    } else {
      toast.showError("Suppression impossible", result.error.userMessage);
    }
    setDeleteTarget(null);
  }

  const canManageEvents = !!session;

  return (
    <Card className="h-full flex flex-col rounded-xl border border-border/70 bg-surface-panel shadow-sm overflow-hidden">
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Calendrier Opérationnel des Flux & Événements
          </CardTitle>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={prevMonth}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="px-1.5 text-sm font-bold tracking-wide text-foreground whitespace-nowrap">
            {MONTHS_FR[cursor.getMonth()]}{" "}
            <span className="font-semibold text-muted-foreground">
              {cursor.getFullYear()}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={nextMonth}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5 ml-1 border-primary/30 text-primary"
            onClick={goToToday}
          >
            Aujourd'hui
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* Month sheet (7 cols) — a real calendar page: an attached weekday
            header, a hairline grid, borrowed adjacent-month days instead of
            blank voids, weekend shading and a today marker. */}
        <div className="lg:col-span-7 min-h-0 flex flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-surface-panel">
            <div className="grid grid-cols-7 gap-px border-b border-border/60 bg-border/50">
              {WEEKDAYS_FR.map((d, di) => (
                <div
                  key={d}
                  className={`bg-surface-elevated/40 py-1 text-center text-[10px] font-bold uppercase tracking-wide ${
                    di >= 5 ? "text-muted-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid flex-1 min-h-0 grid-cols-7 gap-px bg-border/50">
              {monthGrid.map((cell, index) => {
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === todayKey;
                const count = monthEventCounts.get(cell.date) ?? 0;
                const isWeekend = index % 7 >= 5;

                const skin = isSelected
                  ? "bg-primary text-primary-foreground"
                  : !cell.inMonth
                    ? "bg-surface-elevated/20 text-muted-foreground/60 hover:bg-surface-elevated/40"
                    : isToday
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : isWeekend
                        ? "bg-surface-elevated/30 hover:bg-surface-elevated/60"
                        : "bg-surface-panel hover:bg-surface-elevated/50";

                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => selectDate(cell.date)}
                    aria-current={isToday ? "date" : undefined}
                    aria-pressed={isSelected}
                    aria-label={`${cell.date}${count > 0 ? ` — ${count} événement(s)` : ""}`}
                    className={`flex min-h-[34px] flex-col gap-1 p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary ${skin}`}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span
                        className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] leading-none ${
                          isToday && !isSelected
                            ? "bg-primary font-bold text-primary-foreground"
                            : isSelected
                              ? "font-bold"
                              : cell.inMonth
                                ? "font-semibold text-foreground"
                                : "font-medium text-muted-foreground/60"
                        }`}
                      >
                        {cell.day}
                      </span>
                      {count > 0 && (
                        <span
                          className={`text-[9px] font-bold leading-none ${
                            isSelected ? "text-primary-foreground/90" : "text-primary"
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </span>

                    {count > 0 && (
                      <span className="mt-auto flex flex-wrap items-center gap-0.5">
                        {Array.from({ length: Math.min(count, 4) }).map((_, di) => (
                          <span
                            key={di}
                            className={`h-1.5 w-1.5 rounded-full ${
                              isSelected
                                ? "bg-primary-foreground"
                                : cell.inMonth
                                  ? "bg-primary"
                                  : "bg-muted-foreground/60"
                            }`}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Daily Activity Panel (5 cols) */}
        <div className="lg:col-span-5 flex flex-col rounded-xl border border-border/70 bg-surface-elevated/20 overflow-hidden min-h-[230px]">
          <div className="flex items-center justify-between p-3 border-b border-border/50 bg-surface-panel/40">
            <div>
              <p className="text-xs font-bold text-foreground">
                {selectedDate === todayKey
                  ? "Aujourd'hui"
                  : new Date(selectedDate).toLocaleDateString("fr-FR", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono">
                {events.length} opération(s)
              </p>
            </div>

            {canManageEvents && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 border-primary/40 text-primary"
                onClick={() => setCreatorOpen(true)}
              >
                <Plus className="h-3 w-3" />
                Ajouter
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1 max-h-[260px] p-3">
            {events.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Aucune activité enregistrée à cette date.
              </div>
            ) : (
              <div className="space-y-2">
                {events.map((e) => {
                  const Icon = KIND_ICONS[e.kind];
                  const tone = KIND_TONES[e.kind];
                  const isManual =
                    e.kind === "follow_up_call" ||
                    e.kind === "reminder" ||
                    e.kind === "meeting" ||
                    e.kind === "custom";

                  return (
                    <div
                      key={e.id}
                      className="p-2.5 rounded-lg border border-border/50 bg-surface-panel/80 flex items-start gap-2.5 hover:border-border transition-colors"
                    >
                      <div
                        className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
                          tone === "success"
                            ? "bg-status-success/15 text-status-success"
                            : tone === "warning"
                              ? "bg-status-warning/15 text-status-warning"
                              : tone === "info"
                                ? "bg-status-info/15 text-status-info"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {e.title}
                          </span>
                          {e.time && (
                            <Badge
                              variant="outline"
                              className="text-[9px] font-mono px-1 py-0"
                            >
                              {e.time}
                            </Badge>
                          )}
                        </div>

                        {e.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {e.description}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-1 text-[10px]">
                          <span className="font-medium text-muted-foreground">
                            {CALENDAR_EVENT_KIND_LABELS_FR[e.kind]}
                          </span>
                          {e.kind === "payment_received" && (
                            <span className="font-mono font-bold text-status-success">
                              +{formatDzdPlain(e.amount)} DA
                            </span>
                          )}
                        </div>
                      </div>

                      {isManual && canManageEvents && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-status-danger"
                          onClick={() => setDeleteTarget(e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>

      <CalendarEventCreatorModal
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        presetDate={selectedDate}
      />

      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer l'événement ?"
        description={
          deleteTarget
            ? `« ${deleteTarget.title} » sera retiré du calendrier.`
            : ""
        }
        destructive
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
      />
    </Card>
  );
}
