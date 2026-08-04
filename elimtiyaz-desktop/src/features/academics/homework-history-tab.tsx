import { useState } from "react";
import { BookOpen, RefreshCw, Paperclip, Users, Calendar } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { EmptyState } from "../../shared/layout/state-views";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { formatDate, formatRelative } from "../../core/format/date";

export function HomeworkHistoryTab() {
  const repos = useRepositories();
  const toast = useToast();
  const classes = useObservable(() => repos.classes.observe(), []);

  const [classId, setClassId] = useState<string>("");
  const homework = useObservable(
    () => repos.homework.observeForClass(classId || ""),
    [classId],
  );

  async function rePushHomework(hwId: string, title: string) {
    const target = homework.find((h) => h.id === hwId);
    if (!target) return;

    const result = await repos.homework.push({
      classId: target.classId,
      subjectId: target.subjectId,
      teacherId: target.teacherId,
      teacherName: target.teacherName,
      title: `${title} (Rappel / Renvoi)`,
      description: target.description,
      dueDate: target.dueDate,
      attachments: [...target.attachments],
    });

    if (result.ok) {
      toast.showSuccess(
        "Devoir re-notifié",
        "Une nouvelle notification push a été envoyée aux parents et élèves.",
      );
    } else {
      toast.showError("Échec", result.error.userMessage);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Historique des
              devoirs diffusés
            </CardTitle>
            <CardDescription>
              {homework.length} devoir(s) enregistré(s) — Cliquez sur 'Renvoyer'
              pour renvoyer une notification push.
            </CardDescription>
          </div>

          <Select
            value={classId || "__all__"}
            onValueChange={(v) => setClassId(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="w-56 h-8 text-xs">
              <SelectValue placeholder="Toutes les classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Toutes les classes</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {homework.length === 0 ? (
          <EmptyState
            title="Aucun devoir trouvé"
            description="Aucun devoir n'a été publié pour la sélection actuelle."
          />
        ) : (
          <ul className="divide-y divide-border">
            {homework
              .slice()
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              )
              .map((hw) => {
                const cls = classes.find((c) => c.id === hw.classId);
                const isPast =
                  new Date(hw.dueDate).getTime() < new Date().getTime();

                return (
                  <li
                    key={hw.id}
                    className="p-4 hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-semibold text-foreground">
                            {hw.title}
                          </p>
                          <Badge variant="outline">{hw.subjectName}</Badge>
                          {cls && <Badge variant="secondary">{cls.name}</Badge>}
                          {isPast && (
                            <StatusChip
                              label="Échéance dépassée"
                              tone="warning"
                            />
                          )}
                        </div>
                        {hw.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {hw.description}
                          </p>
                        )}
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rePushHomework(hw.id, hw.title)}
                        className="shrink-0"
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Renvoyer
                      </Button>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-1 border-t border-border/40">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> Enseignant :{" "}
                        {hw.teacherName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Échéance :{" "}
                        {formatDate(hw.dueDate)}
                      </span>
                      <span>Publié : {formatRelative(hw.createdAt)}</span>
                      {hw.attachments.length > 0 && (
                        <span className="flex items-center gap-1 font-mono text-primary">
                          <Paperclip className="h-3 w-3" />{" "}
                          {hw.attachments.length} fichier(s)
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
