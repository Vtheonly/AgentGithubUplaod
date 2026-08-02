/**
 * HomeworkHistoryTab — replaces ComingSoonCard in Academics page.
 *
 * Iteration 3-F (plan §06): list of past homework per class with
 * "Renvoyer" (re-push) button per item + acknowledged count.
 *
 * Uses the existing HomeworkRepository.observeForClass() — no new
 * contracts needed. Built on the shared primitives (Card, Button,
 * StatusChip, UnifiedModal) so visual language matches the rest.
 */
import { useState } from "react";
import { BookOpen, RefreshCw, Paperclip, Users } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { EmptyState } from "../../shared/layout/state-views";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import { formatDate, formatRelative } from "../../core/format/date";

export function HomeworkHistoryTab() {
  const repos = useRepositories();
  const toast = useToast();
  const classes = useObservable(() => repos.classes.observe(), []);
  const [classId, setClassId] = useState<string>("");
  const homework = useObservable(
    () => repos.homework.observeForClass(classId || "__all__"),
    [classId],
  );

  // When no class is selected, aggregate homework from all classes
  const allHomework = useObservable(() => repos.homework.observeForClass(""), []);
  const displayed = classId ? homework : allHomework;

  async function rePush(hwId: string, title: string) {
    // Re-fire push notification for an existing homework
    const hw = displayed.find((h) => h.id === hwId);
    if (!hw) return;
    const r = await repos.homework.push({
      classId: hw.classId,
      subjectId: hw.subjectId,
      teacherId: hw.teacherId,
      teacherName: hw.teacherName,
      title: `${title} (Renvoi)`,
      description: hw.description,
      dueDate: hw.dueDate,
      attachments: [...hw.attachments],
    });
    if (r.ok) {
      toast.showSuccess("Devoir renvoyé", "Notification push re-déclenchée vers les parents/élèves.");
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Historique des devoirs
            </CardTitle>
            <CardDescription>
              {displayed.length} devoir(s) diffusés — cliquez sur "Renvoyer" pour re-notifier.
            </CardDescription>
          </div>
          <Select value={classId || "__all__"} onValueChange={(v) => setClassId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Toutes les classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Toutes les classes</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {displayed.length === 0 ? (
          <EmptyState
            title="Aucun devoir diffusé"
            description="Les devoirs diffusés apparaîtront ici avec leur accusé de réception."
          />
        ) : (
          <ul className="divide-y divide-border">
            {displayed
              .slice()
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((hw) => {
                const cls = classes.find((c) => c.id === hw.classId);
                const isPast = new Date(hw.dueDate) < new Date();
                return (
                  <li key={hw.id} className="p-4 hover:bg-accent/5">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{hw.title}</p>
                          <Badge variant="outline">{hw.subjectName}</Badge>
                          {cls && <Badge variant="secondary">{cls.name}</Badge>}
                          {isPast && (
                            <StatusChip label="Échéance passée" tone="warning" />
                          )}
                        </div>
                        {hw.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{hw.description}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rePush(hw.id, hw.title)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Renvoyer
                      </Button>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> Enseignant: {hw.teacherName}
                      </span>
                      <span>Échéance: {formatDate(hw.dueDate)}</span>
                      <span>Diffusé: {formatRelative(hw.createdAt)}</span>
                      {hw.attachments.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Paperclip className="h-3 w-3" /> {hw.attachments.length} pièce(s)
                        </span>
                      )}
                      {hw.acknowledgedCount > 0 && (
                        <span className="text-status-success font-medium">
                           {hw.acknowledgedCount} accusé(s)
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
