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
  const [cursor, setCursor] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(
    today.toISOString().slice(0, 10),
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [monthEventCounts, setMonthEventCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);

  const yearMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;

  useEffect(() => {
    const unsub = repos.calendar
      .observeForMonth(yearMonth)
      .subscribe((monthEvents) => {
        const counts = new Map<string, number>();
        for (const e of monthEvents) {
          counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
        }
        setMonthEventCounts(counts);
      });
    return unsub;
  }, [repos.calendar, yearMonth]);

  useEffect(() => {
    const unsub = repos.calendar
      .observeForDate(selectedDate)
      .subscribe((dayEvents) => {
        setEvents(dayEvents);
      });
    return unsub;
  }, [repos.calendar, selectedDate]);

  const monthGrid = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lastOfMonth = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0,
    );
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const totalDays = lastOfMonth.getDate();
    const cells: Array<{ date: string | null; day: number }> = [];

    for (let i = 0; i < startOffset; i++) cells.push({ date: null, day: 0 });
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date: dateStr, day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: 0 });
    return cells;
  }, [cursor]);

  function prevMonth() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  }
  function goToToday() {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now.toISOString().slice(0, 10));
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
    <Card className="rounded-xl border border-border/70 bg-surface-panel shadow-sm overflow-hidden">
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
          <span className="text-xs font-bold text-foreground px-1">
            {MONTHS_FR[cursor.getMonth()]} {cursor.getFullYear()}
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

      <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Month grid (7 cols) */}
        <div className="lg:col-span-7 space-y-2">
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS_FR.map((d) => (
              <span
                key={d}
                className="text-[10px] font-bold uppercase text-muted-foreground py-1"
              >
                {d}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthGrid.map((cell, i) => {
              if (!cell.date) {
                return (
                  <div
                    key={i}
                    className="h-10 rounded-lg bg-surface-elevated/10"
                  />
                );
              }

              const isSelected = cell.date === selectedDate;
              const isToday = cell.date === today.toISOString().slice(0, 10);
              const count = monthEventCounts.get(cell.date) ?? 0;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => cell.date && setSelectedDate(cell.date)}
                  className={`relative h-10 rounded-lg text-xs font-mono transition-all flex flex-col items-center justify-center ${
                    isSelected
                      ? "bg-primary text-primary-foreground font-bold shadow-sm ring-1 ring-primary"
                      : isToday
                        ? "bg-primary/10 text-primary font-bold border border-primary/40"
                        : "bg-surface-elevated/30 text-foreground hover:bg-surface-elevated/80 border border-border/30"
                  }`}
                >
                  <span>{cell.day}</span>
                  {count > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {Array.from({ length: Math.min(count, 3) }).map(
                        (_, di) => (
                          <span
                            key={di}
                            className={`h-1 w-1 rounded-full ${
                              isSelected ? "bg-white" : "bg-primary"
                            }`}
                          />
                        ),
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Daily Activity Panel (5 cols) */}
        <div className="lg:col-span-5 flex flex-col rounded-xl border border-border/70 bg-surface-elevated/20 overflow-hidden min-h-[260px]">
          <div className="flex items-center justify-between p-3 border-b border-border/50 bg-surface-panel/40">
            <div>
              <p className="text-xs font-bold text-foreground">
                {selectedDate === today.toISOString().slice(0, 10)
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
