/**
 * JustificationsTab — T-040 (ATT-101).
 *
 * The staff-side half of the 4-state absence-justification workflow
 * (migration 0043): parents submit justifications from the web portal
 * (`justification_status='submitted'`), and THIS tab is where staff review
 * them — Accept/Reject writes the decision + reviewer + timestamp, and the
 * parent's portal pill then shows the outcome. Before T-040 the workflow
 * was a one-way valve: parents could submit but no desktop code ever read
 * or wrote the justification columns, so 'accepted'/'rejected' were
 * unreachable.
 */
import { useMemo, useState } from "react";
import { FileCheck, Check, X, ExternalLink, Paperclip, Calendar } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { StatusChip } from "../../shared/ui/status-chip";
import { DataTable, type DataTableColumn } from "../../shared/ui/data-table";
import { formatDate } from "../../core/format/date";
import type { AttendanceRecord } from "../../domain/model/academic";

type ReviewFilter = "submitted" | "accepted" | "rejected";

const SESSION_LABELS: Record<string, string> = {
  morning: "Matin",
  afternoon: "Après-midi",
  both: "Journée",
};

const STATUS_LABELS: Record<string, string> = {
  present: "Présent",
  late: "Retard",
  absent_excused: "Absence justifiée",
  absent_unexcused: "Absence non justifiée",
};

export function JustificationsTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<ReviewFilter>("submitted");
  const [busyId, setBusyId] = useState<string | null>(null);

  const records = useObservable(
    () => repos.attendance.observeJustifications(filter),
    [filter],
  );
  const students = useObservable(() => repos.students.observe(), []);

  const studentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) {
      map.set(s.id, [s.firstName, s.lastName].filter(Boolean).join(" ") || s.displayName || s.id);
    }
    return map;
  }, [students]);

  async function review(record: AttendanceRecord, decision: "accepted" | "rejected") {
    if (!session) return;
    setBusyId(record.id);
    try {
      const result = await repos.attendance.reviewJustification({
        recordId: record.id,
        decision,
        reviewedBy: session.userId,
      });
      if (result.ok) {
        toast.showSuccess(
          decision === "accepted" ? "Justification acceptée" : "Justification refusée",
          "La décision est visible par le parent sur le portail.",
        );
      } else {
        toast.showError("Échec de la revue", result.error.userMessage);
      }
    } finally {
      setBusyId(null);
    }
  }

  const columns: readonly DataTableColumn<AttendanceRecord>[] = [
    {
      header: "Élève",
      accessor: "studentId",
      cell: (r) => (
        <div className="space-y-0.5">
          <span className="font-medium">{studentName.get(r.studentId) ?? r.studentId.slice(0, 8) + "…"}</span>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="size-3" />
            {formatDate(r.date)} · {SESSION_LABELS[r.session] ?? r.session}
          </div>
        </div>
      ),
    },
    {
      header: "Pointage",
      accessor: "status",
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip
            label={STATUS_LABELS[r.status] ?? r.status}
            tone={r.status === "present" ? "success" : r.status === "late" ? "warning" : "danger"}
          />
          <span className="text-xs text-muted-foreground">Statut: {r.justificationStatus ?? "none"}</span>
        </div>
      ),
    },
    {
      header: "Justification du parent",
      accessor: "justificationNote",
      cell: (r) => (
        <div className="space-y-1 max-w-md">
          {r.justificationNote ? (
            <p className="text-xs whitespace-pre-wrap line-clamp-4">{r.justificationNote}</p>
          ) : (
            <p className="text-xs italic text-muted-foreground">Aucune note</p>
          )}
          <div className="flex items-center gap-3">
            {r.justificationPath && (
              <span className="flex items-center gap-1 text-xs font-mono text-primary">
                <Paperclip className="size-3" /> pièce jointe
              </span>
            )}
            {r.justificationDriveLink && (
              <a
                href={r.justificationDriveLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-primary underline"
              >
                <ExternalLink className="size-3" /> Drive
              </a>
            )}
          </div>
        </div>
      ),
    },
    {
      header: "Décision",
      accessor: (r) => r.justificationStatus ?? "none",
      cell: (r) => {
        const decided = r.justificationStatus === "accepted" || r.justificationStatus === "rejected";
        return (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-status-success"
              disabled={busyId === r.id}
              onClick={() => review(r, "accepted")}
            >
              <Check className="size-3.5" /> Accepter
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-status-danger"
              disabled={busyId === r.id}
              onClick={() => review(r, "rejected")}
            >
              <X className="size-3.5" /> Refuser
            </Button>
            {decided && (
              <Badge variant="outline">
                {r.justificationStatus === "accepted" ? "Acceptée" : "Refusée"}
              </Badge>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="size-4" /> Justificatifs d'absence
          </CardTitle>
          <CardDescription>
            Les parents soumettent leurs justificatifs depuis le portail web ; examinez-les ici
            (Accepter / Refuser) — la décision est visible par le parent.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          {(["submitted", "accepted", "rejected"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "ghost"}
              onClick={() => setFilter(f)}
            >
              {f === "submitted" ? "À examiner" : f === "accepted" ? "Acceptées" : "Refusées"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          data={records}
          columns={columns}
          emptyMessage={
            filter === "submitted"
              ? "Aucun justificatif en attente d'examen."
              : filter === "accepted"
                ? "Aucune justification acceptée."
                : "Aucune justification refusée."
          }
        />
      </CardContent>
    </Card>
  );
}
