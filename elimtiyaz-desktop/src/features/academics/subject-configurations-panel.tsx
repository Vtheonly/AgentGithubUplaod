// ============================================================================
// FILE: src/features/academics/subject-configurations-panel.tsx
// ============================================================================
// T-346 (MATIERE-500 / ADR-018): the context-specific subject configuration
// matrix — ONE row per (subject × level × year × direction). This is where
// the admin sets the coefficient per context ("Arabe coefficient 4 en
// 4AM"), the per-bulletin subject code, the passing grade, the
// extracurricular flag and the grading recipe — including the contrôle
// continu (المراقبة المستمرة) weight.
//
// Non-retroactivity (ADR-018 §3): editing a configuration affects FUTURE
// entries; archived years keep their rows untouched.
import { useMemo, useState } from "react";
import { Settings2, Plus, Info } from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import {
  AutoFormModal,
  type AutoFormField,
} from "../../shared/ui/auto-form";
import { Permission } from "../../core/rbac/permissions";
import {
  DEFAULT_GRADING_RECIPE,
  type Subject,
  type SubjectConfiguration,
} from "../../domain/model/academic";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { useCurrentAcademicYear } from "./hooks/use-current-academic-year";

const ConfigSchema = z.object({
  coefficient: z.number().min(0.5).max(20),
  subjectCode: z.string().optional().default(""),
  passingGrade: z.number().min(0).max(20),
  isExtracurricular: z.boolean().default(false),
  recipeD1: z.number().min(0).max(10),
  recipeD2: z.number().min(0).max(10),
  recipeEx: z.number().min(0).max(10),
  recipeCc: z.number().min(0).max(10),
});

type ConfigFormData = z.infer<typeof ConfigSchema>;

const CONFIG_FIELDS: readonly AutoFormField[] = [
  {
    name: "coefficient",
    label: "Coefficient (ce niveau, cette année)",
    type: "number",
    required: true,
    min: 0.5,
    max: 20,
    help: "Le poids de la matière dans la moyenne générale pour CE contexte.",
  },
  {
    name: "subjectCode",
    label: "Code bulletin (optionnel)",
    type: "text",
    placeholder: "ex: ARB-4AM",
    help: "L'identifiant matière sur le bulletin de ce niveau ; vide = le code du répertoire.",
  },
  {
    name: "passingGrade",
    label: "Seuil admis",
    type: "number",
    required: true,
    min: 0,
    max: 20,
    help: "Sur 20",
  },
  {
    name: "isExtracurricular",
    label: "Hors moyenne générale (ce contexte)",
    type: "switch",
    wide: true,
    help: "Si coché, la matière ne compte pas dans la moyenne générale pour CE niveau.",
  },
  {
    name: "recipeD1",
    label: "Poids Devoir 1",
    type: "number",
    required: true,
    min: 0,
    max: 10,
  },
  {
    name: "recipeD2",
    label: "Poids Devoir 2",
    type: "number",
    required: true,
    min: 0,
    max: 10,
  },
  {
    name: "recipeEx",
    label: "Poids Examen",
    type: "number",
    required: true,
    min: 0,
    max: 10,
  },
  {
    name: "recipeCc",
    label: "Poids Contrôle continu (المراقبة المستمرة)",
    type: "number",
    required: true,
    min: 0,
    max: 10,
    help: "0 = la note de contrôle continu n'entre pas dans la moyenne. > 0 = elle compte (ex: 1).",
  },
];

interface ConfigTarget {
  readonly subject: Subject;
  readonly levelId: string;
  readonly levelLabel: string;
  readonly existing: SubjectConfiguration | undefined;
}

export function SubjectConfigurationsPanel() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const subjects = useObservable(() => repos.subjects.observe(), []) ?? [];
  const configurations =
    useObservable(() => repos.subjects.observeConfigurations(), []) ?? [];
  const classes = useObservable(() => repos.classes.observe(), []) ?? [];
  const currentYear = useCurrentAcademicYear();

  const [editing, setEditing] = useState<ConfigTarget | null>(null);

  const canManage =
    !!session && session.permissions.has(Permission.ManageSubjects);

  // The levels actually in use by classes (id + display label), ordered.
  const levels = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; order: string }>();
    for (const c of classes) {
      if (!c.academicLevelId) continue;
      if (!seen.has(c.academicLevelId)) {
        seen.set(c.academicLevelId, {
          id: c.academicLevelId,
          label: LEVEL_LABELS_FR[c.level as keyof typeof LEVEL_LABELS_FR] ?? c.gradeCode,
          order: c.gradeCode,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.order.localeCompare(b.order));
  }, [classes]);

  const byKey = useMemo(() => {
    const m = new Map<string, SubjectConfiguration>();
    for (const c of configurations) {
      m.set(`${c.subjectId}|${c.academicLevelId}`, c);
    }
    return m;
  }, [configurations]);

  const yearConfigurations = useMemo(
    () => configurations.filter((c) => c.academicYearId === currentYear.id),
    [configurations, currentYear.id],
  );

  async function handleSubmit(data: ConfigFormData) {
    if (!editing) return;
    const weights = [
      data.recipeD1,
      data.recipeD2,
      data.recipeEx,
      data.recipeCc,
    ];
    if (weights.reduce((a, b) => a + b, 0) <= 0) {
      throw new Error(
        "La somme des poids doit être supérieure à 0 (au moins un composant doit compter).",
      );
    }
    const result = await repos.subjects.upsertSubjectConfiguration({
      subjectId: editing.subject.id,
      academicYearId: currentYear.id,
      academicLevelId: editing.levelId,
      direction: "general",
      coefficient: data.coefficient,
      subjectCode: (data.subjectCode ?? "").trim() || null,
      passingGrade: data.passingGrade,
      isExtracurricular: data.isExtracurricular,
      gradingRecipe: {
        devoir1: data.recipeD1,
        devoir2: data.recipeD2,
        examen: data.recipeEx,
        cc: data.recipeCc,
      },
      weeklyHours: editing.existing?.weeklyHours ?? null,
      isActive: true,
    });
    if (result.ok) {
      toast.showSuccess(
        "Configuration enregistrée",
        `${editing.subject.name} — ${editing.levelLabel} : coefficient ${result.value.coefficient}. Les nouvelles saisies utiliseront cette configuration (l'historique existant reste inchangé).`,
      );
      setEditing(null);
    } else {
      throw new Error(result.error.userMessage);
    }
  }

  if (levels.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Settings2 className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">
          Configurations par niveau — {currentYear.code}
        </h3>
        <Badge variant="outline" className="font-mono text-[10px]">
          {yearConfigurations.length} ligne(s)
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        Une matière peut être configurée différemment selon le niveau et
        l'année (coefficient, code bulletin, seuil, recette de moyenne —
        incluant le contrôle continu المراقبة المستمرة). Les notes déjà
        saisies conservent la configuration en vigueur au moment de la
        saisie (non-rétroactif).
      </p>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 min-w-40">Matière</th>
                {levels.map((l) => (
                  <th key={l.id} className="py-2 px-2 text-center min-w-20">
                    {l.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subjects.map((s) => (
                <tr key={s.id} className="hover:bg-accent/5">
                  <td className="py-1.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] bg-primary/10 text-primary rounded px-1">
                        {s.code}
                      </span>
                      <span className="font-medium truncate">{s.name}</span>
                    </div>
                  </td>
                  {levels.map((l) => {
                    const cfg = byKey.get(`${s.id}|${l.id}`);
                    const target: ConfigTarget = {
                      subject: s,
                      levelId: l.id,
                      levelLabel: l.label,
                      existing: cfg,
                    };
                    return (
                      <td key={l.id} className="py-1.5 px-2 text-center">
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => setEditing(target)}
                            className={
                              cfg
                                ? "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono font-bold text-primary hover:bg-primary/10"
                                : "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-muted-foreground/60 hover:bg-accent/10 hover:text-muted-foreground"
                            }
                            title={
                              cfg
                                ? `Coefficient ${cfg.coefficient} — recette D1:${cfg.gradingRecipe.devoir1} D2:${cfg.gradingRecipe.devoir2} Ex:${cfg.gradingRecipe.examen} CC:${cfg.gradingRecipe.cc} — cliquer pour modifier`
                                : `Configurer ${s.name} en ${l.label}`
                            }
                          >
                            {cfg ? (
                              <>
                                {cfg.coefficient}
                                {cfg.gradingRecipe.cc > 0 && (
                                  <span
                                    className="text-[9px] font-normal text-status-info"
                                    title="Contrôle continu actif dans la recette"
                                  >
                                    +CC
                                  </span>
                                )}
                              </>
                            ) : (
                              <Plus className="size-3" />
                            )}
                          </button>
                        ) : cfg ? (
                          <span className="font-mono font-bold">
                            {cfg.coefficient}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AutoFormModal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={
          editing
            ? `${editing.subject.name} — ${editing.levelLabel} (${currentYear.code})`
            : ""
        }
        description="Configuration de la matière pour ce niveau et cette année scolaire (ADR-018)."
        schema={ConfigSchema}
        fields={CONFIG_FIELDS}
        initialValues={
          editing
            ? {
                coefficient: editing.existing?.coefficient ?? editing.subject.coefficient,
                subjectCode: editing.existing?.subjectCode ?? "",
                passingGrade: editing.existing?.passingGrade ?? editing.subject.passingGrade,
                isExtracurricular:
                  editing.existing?.isExtracurricular ??
                  editing.subject.isExtracurricular,
                recipeD1:
                  editing.existing?.gradingRecipe.devoir1 ??
                  DEFAULT_GRADING_RECIPE.devoir1,
                recipeD2:
                  editing.existing?.gradingRecipe.devoir2 ??
                  DEFAULT_GRADING_RECIPE.devoir2,
                recipeEx:
                  editing.existing?.gradingRecipe.examen ??
                  DEFAULT_GRADING_RECIPE.examen,
                recipeCc:
                  editing.existing?.gradingRecipe.cc ?? DEFAULT_GRADING_RECIPE.cc,
              }
            : undefined
        }
        onSubmit={handleSubmit}
        submitLabel={
          editing?.existing
            ? "Enregistrer la configuration"
            : "Créer la configuration"
        }
      />
    </div>
  );
}
