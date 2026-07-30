/**
 * GradeEntryScreen — inline-editable grade table (plan §06.02 / §06.03).
 *
 * Layout: Élève | D1 | D2 | Examen | Moy.
 *
 * Live recomputation:
 *   subject_average = (D1 + D2 + 2·Examen) / 4   (each 0..20)
 *   overall_gpa     = Σ(subject_avg × coef) / Σ(coef)
 *
 * Passing grade: 10.0 (admin-configurable).
 *
 * Validation: scores 0-20, validated at schema level (here: client-side).
 * Sticky class-average header with passing/failing/missing counts.
 */
import { useState, useMemo, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  computeSubjectAverage,
  isPassing,
  validateScore,
  type AcademicTerm,
  type Assessment,
} from "../../domain/model/academic";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { cn } from "../../shared/ui/cn";

interface Row {
  studentId: string;
  firstName: string;
  lastName: string;
  code: string;
  d1: string; // string for input binding; parsed on save
  d2: string;
  examen: string;
}

export function GradeEntryScreen() {
  const { classId, subjectId } = useParams<{ classId: string; subjectId: string }>();
  const navigate = useNavigate();
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const cls = useObservable(() => repos.classes.observeById(classId ?? ""), [classId]);
  const students = useObservable(() => repos.students.observeByClass(classId ?? ""), [classId]);
  const subjects = useObservable(() => repos.subjects.observe(), []);

  const subject = subjects.find((s) => s.id === subjectId);
  const [term, setTerm] = useState<AcademicTerm>("T1");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  // Initialize rows when students load.
  useEffect(() => {
    if (rows.length === 0 && students.length > 0) {
      setRows(
        students.map((s) => ({
          studentId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          code: s.code,
          d1: "",
          d2: "",
          examen: "",
        })),
      );
    }
  }, [students, rows.length]);

  function updateRow(studentId: string, field: "d1" | "d2" | "examen", value: string) {
    // Sanitize: digits + dot + comma
    const cleaned = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    setRows((curr) => curr.map((r) => (r.studentId === studentId ? { ...r, [field]: cleaned } : r)));
  }

  function parseScore(s: string): number | null {
    if (!s.trim()) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (!validateScore(n)) return null;
    return n;
  }

  // Live stats
  const stats = useMemo(() => {
    let passing = 0;
    let failing = 0;
    let missing = 0;
    let sum = 0;
    let count = 0;
    for (const r of rows) {
      const d1 = parseScore(r.d1);
      const d2 = parseScore(r.d2);
      const ex = parseScore(r.examen);
      if (d1 == null && d2 == null && ex == null) {
        missing++;
        continue;
      }
      const avg = computeSubjectAverage(d1, d2, ex);
      if (avg == null) {
        missing++;
        continue;
      }
      sum += avg;
      count++;
      if (isPassing(avg)) passing++;
      else failing++;
    }
    return {
      passing,
      failing,
      missing,
      classAverage: count > 0 ? sum / count : null,
    };
  }, [rows]);

  async function save() {
    if (!session || !classId || !subjectId) return;
    setSaving(true);
    try {
      let saved = 0;
      for (const r of rows) {
        const d1 = parseScore(r.d1);
        const d2 = parseScore(r.d2);
        const ex = parseScore(r.examen);
        if (d1 == null && d2 == null && ex == null) continue; // skip empty rows
        const result = await repos.grades.enterGrade({
          studentId: r.studentId,
          subjectId,
          classId,
          term,
          academicYear: cls?.academicYear ?? "2025-2026",
          devoir1: d1,
          devoir2: d2,
          examen: ex,
          coefficient: subject?.coefficient ?? 1,
          enteredBy: session.userId,
        });
        if (result.ok) saved++;
      }
      toast.showSuccess("Notes enregistrées", `${saved} note(s) saisie(s).`);
      navigate(`/academics/class/${classId}`);
    } finally {
      setSaving(false);
    }
  }

  if (!cls || !subject) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Introuvable" />
        <Button variant="outline" onClick={() => navigate("/academics")} className="mx-6 w-fit">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Notes — ${subject.name}`}
        description={`${cls.name} · Coefficient ${subject.coefficient} · ${subject.code}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate(`/academics/class/${classId}`)}>
            <ArrowLeft className="h-4 w-4" /> Annuler
          </Button>
        }
      />

      {/* Config bar */}
      <div className="flex items-end gap-3 px-6 pb-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Trimestre</Label>
          <Select value={term} onValueChange={(v) => setTerm(v as AcademicTerm)}>
            <SelectTrigger className="w-32 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="T1">Trimestre 1</SelectItem>
              <SelectItem value="T2">Trimestre 2</SelectItem>
              <SelectItem value="T3">Trimestre 3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Moyenne de classe:</span>
          <Badge variant={stats.classAverage == null ? "outline" : isPassing(stats.classAverage) ? "success" : "danger"}>
            {stats.classAverage == null ? "—" : stats.classAverage.toFixed(2)}
          </Badge>
        </div>
      </div>

      {/* Sticky stats header */}
      <div className="mx-6 mb-3 grid grid-cols-3 gap-2">
        <StatBox label="Réussite" value={stats.passing} icon={<TrendingUp className="h-4 w-4" />} tone="success" />
        <StatBox label="Échec" value={stats.failing} icon={<TrendingDown className="h-4 w-4" />} tone="danger" />
        <StatBox label="Manquantes" value={stats.missing} icon={<Minus className="h-4 w-4" />} tone="warning" />
      </div>

      {/* Grade table */}
      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-popover border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 px-3">Élève</th>
                  <th className="py-2 px-3 text-center w-20">D1</th>
                  <th className="py-2 px-3 text-center w-20">D2</th>
                  <th className="py-2 px-3 text-center w-20">Examen</th>
                  <th className="py-2 px-3 text-center w-24">Moy.</th>
                  <th className="py-2 px-3 text-center w-20">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const d1 = parseScore(r.d1);
                  const d2 = parseScore(r.d2);
                  const ex = parseScore(r.examen);
                  const avg = computeSubjectAverage(d1, d2, ex);
                  const hasInvalid =
                    (r.d1 && d1 == null) || (r.d2 && d2 == null) || (r.examen && ex == null);
                  return (
                    <tr key={r.studentId} className="hover:bg-accent/5">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-[10px]">
                              {r.firstName[0]}{r.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{r.firstName} {r.lastName}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{r.code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <ScoreCell value={r.d1} onChange={(v) => updateRow(r.studentId, "d1", v)} invalid={!!r.d1 && d1 == null} />
                      </td>
                      <td className="py-2 px-3">
                        <ScoreCell value={r.d2} onChange={(v) => updateRow(r.studentId, "d2", v)} invalid={!!r.d2 && d2 == null} />
                      </td>
                      <td className="py-2 px-3">
                        <ScoreCell value={r.examen} onChange={(v) => updateRow(r.studentId, "examen", v)} invalid={!!r.examen && ex == null} />
                      </td>
                      <td className="py-2 px-3 text-center font-mono font-semibold">
                        {avg == null ? "—" : avg.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {avg == null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : isPassing(avg) ? (
                          <StatusChip label="Réussite" tone="success" />
                        ) : (
                          <StatusChip label="Échec" tone="danger" />
                        )}
                        {hasInvalid && (
                          <div className="text-[10px] text-status-danger mt-0.5">Invalide (0-20)</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-surface-panel/95 backdrop-blur-sm p-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Formule: <code className="font-mono">moy = (D1 + D2 + 2·Examen) / 4</code> · Seuil réussite: 10/20
        </p>
        <Button onClick={save} disabled={saving || rows.length === 0}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" /> Enregistrer les notes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function ScoreCell({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="—"
      className={cn(
        "h-8 w-16 mx-auto text-center font-mono text-sm",
        invalid && "border-status-danger focus-visible:ring-status-danger",
      )}
    />
  );
}

function StatBox({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "success" | "danger" | "warning";
}) {
  const toneClass = {
    success: "text-status-success",
    danger: "text-status-danger",
    warning: "text-status-warning",
  }[tone];
  return (
    <div className="rounded-md border border-border p-2 flex items-center gap-2">
      <span className={toneClass}>{icon}</span>
      <div>
        <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-mono font-semibold", toneClass)}>{value}</p>
      </div>
    </div>
  );
}
