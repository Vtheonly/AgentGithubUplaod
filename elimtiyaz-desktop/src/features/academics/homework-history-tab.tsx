/**
 * HomeworkHistoryTab — refactored to use <DataTable>.
 * Savings: 178 → ~95 lines (-47%).
 */
import { useState } from "react";
import { BookOpen, RefreshCw, Paperclip, Users, Calendar } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { DataTable, type DataTableColumn } from "../../shared/ui/data-table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import { formatDate, formatRelative } from "../../core/format/date";
import type { Homework } from "../../domain/model/academic";

export function HomeworkHistoryTab() {
  const repos = useRepositories();
  const toast = useToast();
  const classes = useObservable(() => repos.classes.observe(), []);
  const [classId, setClassId] = useState<string>("");
  const homework = useObservable(() => repos.homework.observeForClass(classId || ""), [classId]);

  async function rePushHomework(hw: Homework) {
    const result = await repos.homework.push({
      classId: hw.classId, subjectId: hw.subjectId, teacherId: hw.teacherId, teacherName: hw.teacherName,
      title: `${hw.title} (Rappel / Renvoi)`, description: hw.description,
      dueDate: hw.dueDate, attachments: [...hw.attachments],
    });
    if (result.ok) toast.showSuccess("Devoir re-notifié", "Une nouvelle notification push a été envoyée aux parents et élèves.");
    else toast.showError("Échec", result.error.userMessage);
  }

  const columns: readonly DataTableColumn<Homework>[] = [
    {
      header: "Devoir",
      accessor: "title",
      cell: (hw) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{hw.title}</span>
            <Badge variant="outline">{hw.subjectName}</Badge>
            {(() => { const cls = classes.find((c) => c.id === hw.classId); return cls && <Badge variant="secondary">{cls.name}</Badge>; })()}
            {new Date(hw.dueDate).getTime() < Date.now() && <StatusChip label="Échéance dépassée" tone="warning" />}
          </div>
          {hw.description && <p className="text-xs text-muted-foreground line-clamp-2">{hw.description}</p>}
        </div>
      ),
    },
    { header: "Enseignant", accessor: "teacherName", cell: (hw) => <span className="flex items-center gap-1 text-xs"><Users className="size-3" />{hw.teacherName}</span> },
    { header: "Échéance", accessor: "dueDate", cell: (hw) => <span className="flex items-center gap-1 text-xs"><Calendar className="size-3" />{formatDate(hw.dueDate)}</span> },
    { header: "Publié", accessor: "createdAt", cell: (hw) => <span className="text-xs text-muted-foreground">{formatRelative(hw.createdAt)}</span> },
    {
      header: "Fichiers",
      accessor: (hw) => hw.attachments.length,
      cell: (hw) => hw.attachments.length > 0
        ? <span className="flex items-center gap-1 text-xs font-mono text-primary"><Paperclip className="size-3" />{hw.attachments.length}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
  ];

  const sortedHomework = homework.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2"><BookOpen className="size-4 text-primary" /> Historique des devoirs diffusés</CardTitle>
            <CardDescription>{homework.length} devoir(s) enregistré(s) — Cliquez sur « Renvoyer » pour renvoyer une notification push.</CardDescription>
          </div>
          <Select value={classId || "__all__"} onValueChange={(v) => setClassId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="Toutes les classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Toutes les classes</SelectItem>
              {classes.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        <DataTable<Homework>
          data={sortedHomework}
          columns={columns}
          searchFields={["title", "subjectName", "teacherName"]}
          searchPlaceholder="Rechercher un devoir…"
          emptyMessage="Aucun devoir trouvé pour la sélection actuelle."
          pageSize={10}
          actions={[{ label: "Renvoyer", icon: <RefreshCw className="size-3.5" />, variant: "outline", onClick: (hw) => rePushHomework(hw) }]}
        />
      </CardContent>
    </Card>
  );
}
