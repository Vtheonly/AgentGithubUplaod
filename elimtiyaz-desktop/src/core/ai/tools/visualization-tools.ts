// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/tools/visualization-tools.ts
// ============================================================================
/**
 * Visualization tool suite (T-274, 42nd session — AI-311c).
 *
 * Two tools that let the MODEL compose visuals beyond the ones the
 * analysis tools auto-emit:
 *   - render_chart               → a custom chart from data the model has
 *                                  already gathered (any combination it
 *                                  wants to show the user)
 *   - draw_relationship_diagram  → a REAL structural diagram built from
 *                                  canonical entities (family tree for a
 *                                  parent, class roster structure) — the
 *                                  nodes/edges come from the repositories,
 *                                  never from model memory.
 *
 * The artifact is validated by artifacts.ts before it reaches the
 * drawer (the render-path gate — ADR-016 §3); a malformed model attempt
 * returns a structured error the model can correct, never a broken UI.
 */
import type { Repositories } from "../../../app/providers/repository-provider";
import type { ToolDefinition } from "../agent-types";
import { withArtifact, validateChartArtifact } from "../artifacts";
import { parentDisplayName } from "../../../domain/model/parent";
import { studentDisplayName } from "../../../domain/model/student";
import type { AcademicYear } from "../../../domain/model/academic";
import type { DiagramNode, DiagramEdge } from "../artifacts";

/* ------------------------------------------------------------------ */
/*  Tool schemas                                                       */
/* ------------------------------------------------------------------ */

export const VISUALIZATION_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "render_chart",
      description:
        "Générer un graphique personnalisé à partir de données déjà collectées (via les autres outils) : barres, barres groupées, barres empilées, courbe, aire, camembert ou anneau. Le graphique s'affiche directement dans la conversation. Utilisez-le pour illustrer une comparaison ou une synthèse que vous venez de calculer.",
      parameters: {
        type: "object",
        properties: {
          chart_type: {
            type: "string",
            description: "Le type de graphique",
            enum: ["bar", "grouped_bar", "stacked_bar", "line", "area", "pie", "donut"],
          },
          title: { type: "string", description: "Titre du graphique (concis et descriptif)." },
          categories: {
            type: "array",
            items: { type: "string" },
            description: "Les libellés de l'axe X (ou les parts pour pie/donut). Max 60.",
          },
          series: {
            type: "array",
            description:
              "Les séries de données. Chaque série : { name: string, data: number[] } — data doit avoir la même longueur que categories. pie/donut exigent exactement 1 série. Max 6 séries.",
          },
          unit: {
            type: "string",
            description: "Optionnel: l'unité affichée",
            enum: ["DZD", "percent", "count", "rate", "score"],
          },
          caption: { type: "string", description: "Optionnel: légende explicative sous le graphique." },
        },
        required: ["chart_type", "title", "categories", "series"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draw_relationship_diagram",
      description:
        "Dessiner un diagramme structurel réel à partir des données du système : l'arborescence d'une famille (parent → enfants → classes), la structure d'une classe (classe → élèves), ou un flux de processus métier. Les nœuds proviennent des données réelles — jamais de mémoire.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description: "Le type de structure à dessiner",
            enum: ["family", "class"],
          },
          parent_id: { type: "string", description: "UUID du parent (scope family)." },
          class_id: { type: "string", description: "UUID de la classe (scope class)." },
        },
        required: ["scope"],
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Execution                                                          */
/* ------------------------------------------------------------------ */

export async function executeVisualizationTool(
  name: string,
  args: Record<string, unknown>,
  repos: Repositories,
): Promise<string> {
  switch (name) {
    /* ---------------- render_chart ---------------- */
    case "render_chart": {
      // Validate the model's composition through the SAME gate the
      // drawer uses — a malformed chart never renders.
      const candidate = {
        kind: "chart" as const,
        chartType: args.chart_type,
        title: args.title,
        categories: Array.isArray(args.categories) ? args.categories : [],
        series: Array.isArray(args.series) ? args.series : [],
        unit: args.unit,
        caption: args.caption,
      };
      const chart = validateChartArtifact(candidate);
      if (!chart) {
        return JSON.stringify({
          error: "Graphique invalide : vérifiez chart_type, title, categories (non vide, ≤ 60 libellés) et series (1–6 séries, longueurs alignées, nombres finis).",
          hint: "pie/donut exigent exactement UNE série de valeurs positives ; stacked_bar refuse les négatifs.",
        });
      }
      return withArtifact(
        {
          status: "chart_rendered",
          chart_type: chart.chartType,
          title: chart.title,
          series_count: chart.series.length,
          category_count: chart.categories.length,
          message: "Le graphique est affiché dans la conversation.",
        },
        chart,
      );
    }

    /* ---------------- draw_relationship_diagram ---------------- */
    case "draw_relationship_diagram": {
      const scope = String(args.scope ?? "");

      if (scope === "family") {
        const parentId = typeof args.parent_id === "string" ? args.parent_id.trim() : "";
        if (!parentId) {
          return JSON.stringify({
            error: "Paramètre manquant : parent_id est obligatoire pour le scope family.",
            hint: "Utilisez search_entities pour identifier le parent.",
          });
        }
        const parent = repos.parents.observeById(parentId).get();
        if (!parent) return JSON.stringify({ error: `Aucun parent avec l'identifiant « ${parentId} ».` });

        const children = repos.students.observeByParent(parentId).get();
        const classes = repos.classes.observe().get();

        const nodes: DiagramNode[] = [
          {
            id: "parent",
            label: parentDisplayName(parent),
            sublabel: `${parent.code} · ${parent.phone ?? "sans téléphone"}`,
            level: 0,
            kind: "root",
          },
        ];
        const edges: DiagramEdge[] = [];
        children.forEach((child, i) => {
          const cls = child.classId ? classes.find((c) => c.id === child.classId) : null;
          const childId = `child-${i}`;
          nodes.push({
            id: childId,
            label: studentDisplayName(child),
            sublabel: `${child.code} · ${child.gradeLevel}`,
            level: 1,
            kind: "leaf" as const,
          });
          edges.push({ from: "parent", to: childId, label: "enfant" });
          if (cls) {
            const classNodeId = `class-${cls.id}`;
            if (!nodes.some((n) => n.id === classNodeId)) {
              nodes.push({
                id: classNodeId,
                label: cls.name,
                sublabel: `${cls.code} · ${cls.level}`,
                level: 2,
                kind: "branch" as const,
              });
            }
            edges.push({ from: childId, to: classNodeId, label: "inscrit" });
          }
        });

        if (children.length === 0) {
          return JSON.stringify({
            error: `Aucun enfant enregistré pour ${parentDisplayName(parent)} — le diagramme serait vide.`,
          });
        }

        return withArtifact(
          {
            status: "diagram_rendered",
            scope: "family",
            parent: parentDisplayName(parent),
            children_count: children.length,
            message: "Le diagramme familial est affiché dans la conversation.",
          },
          {
            kind: "diagram",
            diagramType: "hierarchy",
            title: `Structure familiale — ${parentDisplayName(parent)}`,
            nodes,
            edges,
            caption: `${children.length} enfant(s) scolarisé(s).`,
          },
        );
      }

      if (scope === "class") {
        const classId = typeof args.class_id === "string" ? args.class_id.trim() : "";
        if (!classId) {
          return JSON.stringify({
            error: "Paramètre manquant : class_id est obligatoire pour le scope class.",
            hint: "Utilisez search_entities avec entity_type=class pour identifier la classe.",
          });
        }
        const cls = repos.classes.observeById(classId).get();
        if (!cls) return JSON.stringify({ error: "Classe introuvable." });
        const students = repos.students.observeByClass(classId).get();
        const capped = students.slice(0, 12); // diagram readability cap

        // Teachers of the class come from the canonical timetable of the
        // CURRENT academic year (the Teacher entity has no classIds — the
        // timetable entries are the link, teacher.ts §TimetableEntry).
        const currentYear = repos.academicYears
          .observeAll()
          .get()
          .find((y: AcademicYear) => y.isCurrent && !y.isArchived);
        const teacherIds = new Set<string>();
        if (currentYear) {
          for (const entry of repos.teachers.observeTimetableForClass(classId, currentYear.id).get()) {
            teacherIds.add(entry.teacherId);
          }
        }
        const allTeachers = repos.teachers.observe().get();
        const classTeachers = [...teacherIds]
          .map((id) => allTeachers.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => Boolean(t))
          .slice(0, 4);

        const nodes: DiagramNode[] = [
          {
            id: "class",
            label: cls.name,
            sublabel: `${cls.code} · ${cls.level} · ${students.length} élèves`,
            level: 0,
            kind: "root",
          },
        ];
        const edges: DiagramEdge[] = [];
        classTeachers.forEach((t, i) => {
          const tid = `teacher-${i}`;
          nodes.push({
            id: tid,
            label: `${t.firstName} ${t.lastName}`,
            sublabel: t.code,
            level: 1,
            kind: "branch" as const,
          });
          edges.push({ from: "class", to: tid, label: "enseigne" });
        });
        capped.forEach((s, i) => {
          const sid = `student-${i}`;
          nodes.push({
            id: sid,
            label: studentDisplayName(s),
            sublabel: s.code,
            level: 1,
            kind: "leaf" as const,
          });
          edges.push({ from: "class", to: sid, label: "élève" });
        });

        return withArtifact(
          {
            status: "diagram_rendered",
            scope: "class",
            class: cls.name,
            student_count: students.length,
            shown_count: capped.length,
            truncated: students.length > capped.length,
            message: "Le diagramme de classe est affiché dans la conversation.",
          },
          {
            kind: "diagram",
            diagramType: "hierarchy",
            title: `Structure de la classe — ${cls.name}`,
            nodes,
            edges,
            caption:
              students.length > capped.length
                ? `${capped.length} élèves affichés sur ${students.length} (lisibilité).`
                : undefined,
          },
        );
      }

      return JSON.stringify({ error: `Scope inconnu : ${scope}` });
    }

    default:
      return JSON.stringify({ error: `Outil de visualisation inconnu : ${name}` });
  }
}
