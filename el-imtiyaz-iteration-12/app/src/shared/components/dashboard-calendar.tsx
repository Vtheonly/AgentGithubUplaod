/**
 * DashboardCalendar — embedded calendar view inside the Dashboard Overview tab.
 *
 * Iteration 9 — Integrated Calendar View (plan §15 expansion).
 *
 * Per spec §3.1: "Add a dedicated Calendar view directly inside the merged
 * Dashboard Overview tab."
 *
 * Per spec §3.2: "Selecting any date on the calendar must display what
 * happened on that specific day, including payments received (who paid on
 * that date), operational logs, and daily events (it should *not* list
 * unpaid/overdue debt balances)."
 *
 * Per spec §3.3: "Allow users to interactively add, remove, and manage
 * scheduled entries, follow-up calls, reminders, and custom events."
 *
 * Layout: month grid on the left (clickable days), daily activity panel on
 * the right (events for the selected day, sorted by time). An "Add event"
 * button above the daily panel opens the CalendarEventCreatorModal.
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
import { useRepositories } from "../../infrastructure/repository-provider";
import { useToast } from "../../state/toast-context";
import { useAuth } from "../../state/auth-context";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { StatusChip } from "./status-chip";
import { CalendarEventCreatorModal } from "./calendar-event-creator-modal";
import { ConfirmModal } from "./unified-modal";
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
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
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

const KIND_TONES: Record<CalendarEventKind, "success" | "neutral" | "info" | "warning" | "danger"> = {
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
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today.toISOString().slice(0, 10));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [monthEventCounts, setMonthEventCounts] = useState<Map<string, number>>(new Map());
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);

  const yearMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;

  // Subscribe to month events for the dot indicators.
  useEffect(() => {
    const unsub = repos.calendar.observeForMonth(yearMonth).subscribe((monthEvents) => {
      const counts = new Map<string, number>();
      for (const e of monthEvents) {
        counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
      }
      setMonthEventCounts(counts);
    });
    return unsub;
  }, [repos.calendar, yearMonth]);

  // Subscribe to selected date events.
  useEffect(() => {
    const unsub = repos.calendar.observeForDate(selectedDate).subscribe((dayEvents) => {
      setEvents(dayEvents);
    });
    return unsub;
  }, [repos.calendar, selectedDate]);

  const monthGrid = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    // ISO weekday: Mon=1, Sun=7 → shift to index 0-6 (Mon first)
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
      toast.showSuccess("Événement supprimé", `« ${deleteTarget.title} » a été retiré du calendrier.`);
    } else {
      toast.showError("Suppression impossible", result.error.userMessage);
    }
    setDeleteTarget(null);
  }

  const canManageEvents = !!session;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-primary" />
            Calendrier opérationnel
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={prevMonth}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={goToToday}>
              Aujourd'hui
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={nextMonth}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {MONTHS_FR[cursor.getMonth()]} {cursor.getFullYear()}
        </p>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
        {/* Month grid */}
        <div className="space-y-1">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS_FR.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthGrid.map((cell, i) => {
              if (!cell.date) return <div key={i} className="h-10 rounded-md" />;
              const isSelected = cell.date === selectedDate;
              const isToday = cell.date === today.toISOString().slice(0, 10);
              const eventCount = monthEventCounts.get(cell.date) ?? 0;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => cell.date && setSelectedDate(cell.date)}
                  className={`relative h-10 rounded-md border text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/15 text-primary font-medium"
                      : isToday
                        ? "border-status-info/50 bg-status-info/10 text-foreground"
                        : "border-border bg-background hover:bg-accent/10"
                  }`}
                >
                  <span className="absolute top-1 left-1.5">{cell.day}</span>
                  {eventCount > 0 && (
                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                      {Array.from({ length: Math.min(eventCount, 3) }).map((_, dotIdx) => (
                        <span
                          key={dotIdx}
                          className={`h-1 w-1 rounded-full ${
                            isSelected ? "bg-primary" : "bg-status-info"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Daily activity panel */}
        <div className="flex flex-col min-h-0 rounded-md border border-border">
          <div className="flex items-center justify-between p-2 border-b border-border">
            <div>
              <p className="text-xs font-medium text-foreground">
                {selectedDate === today.toISOString().slice(0, 10)
                  ? "Aujourd'hui"
                  : new Date(selectedDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {events.length} événement{events.length > 1 ? "s" : ""}
              </p>
            </div>
            {canManageEvents && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setCreatorOpen(true)}
                title="Planifier un événement"
              >
                <Plus className="h-3 w-3" />
                Ajouter
              </Button>
            )}
          </div>
          <ScrollArea className="flex-1 max-h-[420px]">
            {events.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Aucune activité enregistrée à cette date.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {events.map((e) => {
                  const Icon = KIND_ICONS[e.kind];
                  const tone = KIND_TONES[e.kind];
                  const isManual =
                    e.kind === "follow_up_call" ||
                    e.kind === "reminder" ||
                    e.kind === "meeting" ||
                    e.kind === "custom";
                  return (
                    <li
                      key={e.id}
                      className="flex items-start gap-3 p-2.5 hover:bg-accent/5"
                    >
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                        tone === "success" ? "bg-status-success/15 text-status-success"
                          : tone === "warning" ? "bg-status-warning/15 text-status-warning"
                          : tone === "info" ? "bg-status-info/15 text-status-info"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-foreground truncate">{e.title}</p>
                          {e.time && (
                            <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                              {e.time}
                            </Badge>
                          )}
                        </div>
                        {e.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            {e.description}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1">
                          <StatusChip
                            label={CALENDAR_EVENT_KIND_LABELS_FR[e.kind]}
                            tone={tone}
                          />
                          {e.priority !== "low" && (
                            <StatusChip
                              label={`Priorité ${ALERT_PRIORITY_LABELS_FR[e.priority]}`}
                              tone={ALERT_PRIORITY_TONE[e.priority]}
                            />
                          )}
                          {e.kind === "payment_received" && (
                            <span className="text-[10px] font-mono text-status-success">
                              {formatDzdPlain(e.amount)}
                            </span>
                          )}
                          {e.kind === "expense_event" && (
                            <span className="text-[10px] font-mono text-foreground">
                              {formatDzdPlain(e.amount)}
                            </span>
                          )}
                        </div>
                      </div>
                      {isManual && canManageEvents && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-status-danger"
                          onClick={() => setDeleteTarget(e)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
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
        description={deleteTarget ? `« ${deleteTarget.title} » sera retiré du calendrier.` : ""}
        destructive
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
      />
    </Card>
  );
}
