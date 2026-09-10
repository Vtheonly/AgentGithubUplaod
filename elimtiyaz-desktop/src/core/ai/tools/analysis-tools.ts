// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/tools/analysis-tools.ts
// ============================================================================
/**
 * Statistical-analysis tool suite (T-273, 42nd session — AI-311b).
 *
 * Five tools that turn raw canonical streams into DECISION-GRADE output:
 *   - analyze_revenue_trends   → 12-month revenue + MoM growth + moving
 *                                average + OLS trend + LINE chart
 *   - compute_statistics       → descriptive stats + Tukey outliers +
 *                                distribution histogram for a named dataset
 *   - detect_anomalies         → payment outliers / attendance deviations /
 *                                grade collapses (the dispute, décrochage
 *                                and pedagogical lenses)
 *   - compare_classes          → cross-class benchmarking table + ranking
 *   - get_enrollment_demographics → the 4 canonical demographic slices
 *
 * SCOPE DISCIPLINE (ADR-016 §2): every figure the model reads comes from
 * a canonical repository stream or canonical engine
 * (`evaluateStudentTermPerformance`, `calculateAttendanceRate`); the
 * statistics module only ENRICHES (mean/median/trend/outliers). No
 * parallel derivation of any business number (§15.5/§15.16).
 *
 * Every result that benefits from a visual carries a validated CHART
 * artifact under the reserved "artifact" key — the drawer renders it
 * (T-272), the model reads the data JSON (protocol unchanged).
 */
import type { Repositories } from "../../../app/providers/repository-provider";
import type { ToolDefinition } from "../agent-types";
import {
  withArtifact,
  type ChartArtifact,
} from "../artifacts";
import {
  computeDescriptiveStats,
  computeTrend,
  movingAverage,
  periodGrowthPercent,
  bucketize,
  DZD_AMOUNT_BUCKETS,
  GPA_BUCKETS,
  type DescriptiveStats,
} from "../analysis/statistics";
import {
  detectPaymentAnomalies,
  detectAttendanceAnomalies,
  detectGradeAnomalies,
  compareClassPerformance,
  type ClassPerformanceRow,
} from "../analysis/insights";
import { evaluateStudentTermPerformance } from "../../../domain/calc/academics/gpa";
import { calculateAttendanceRate } from "../../../domain/model/academic";
import { studentDisplayName } from "../../../domain/model/student";

/* ------------------------------------------------------------------ */
/*  Tool schemas                                                       */
/* ------------------------------------------------------------------ */

export const ANALYSIS_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "analyze_revenue_trends",
      description:
        "Analyser l'évolution des revenus sur 12 mois : série mensuelle, croissance mois par mois, moyenne mobile 3 mois, tendance linéaire (pente, R²), meilleur et pire mois. Retourne un graphique linéaire interactif. Idéal pour « comment évoluent nos revenus ? » ou toute question de prévision.",
      parameters: {
        type: "object",
        properties: {
          moving_average_window: {
            type: "number",
            description: "Optionnel: fenêtre de la moyenne mobile (défaut 3, max 6).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_statistics",
      description:
        "Calculer les statistiques descriptives complètes (moyenne, médiane, écart-type, quartiles, intervalle interquartile, min/max) et détecter les valeurs atypiques (méthode de Tukey) sur un jeu de données nommé : montants des paiements, créances, moyennes d'une classe, ou taux d'assiduité. Retourne un histogramme de distribution.",
      parameters: {
        type: "object",
        properties: {
          dataset: {
            type: "string",
            description: "Le jeu de données à analyser",
            enum: ["payment_amounts", "debt_amounts", "class_gpas", "attendance_rates"],
          },
          class_id: {
            type: "string",
            description: "Obligatoire pour class_gpas et attendance_rates : UUID de la classe.",
          },
        },
        required: ["dataset"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_anomalies",
      description:
        "Détecter automatiquement les anomalies : montants de paiement atypiques (erreurs de saisie, paiements multiples suspectes — résolution de contestations), écarts d'assiduité par rapport à la classe (décrochage scolaire), ou effondrements de notes dans une matière. Chaque anomalie vient avec son explication.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description: "Le domaine d'anomalies à scanner",
            enum: ["payments", "attendance", "grades"],
          },
          class_id: {
            type: "string",
            description: "Obligatoire pour attendance et grades : UUID de la classe à scanner.",
          },
          parent_id: {
            type: "string",
            description: "Optionnel pour payments : restreindre l'analyse aux paiements d'un parent.",
          },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_classes",
      description:
        "Comparer les performances de plusieurs classes : moyenne, médiane, dispersion, taux de réussite, effectifs et élèves à risque, avec classement complet et identification de la meilleure et de la plus faible classe. Retourne un graphique en barres comparatif. Base des décisions d'affectation pédagogique.",
      parameters: {
        type: "object",
        properties: {
          class_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Optionnel: UUIDs des classes à comparer (défaut: toutes les classes, max 10).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_enrollment_demographics",
      description:
        "Démographie de l'école : effectifs par niveau (Primaire/CEM/Lycée), par genre, par tranche d'âge, et taux de remplissage par niveau (inscrits / capacité). Retourne un graphique du taux de remplissage. Utile pour la planification de capacité et les inscriptions.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/** Serialize stats for the wire (nulls stay explicit — never NaN). */
function statsToJson(s: DescriptiveStats): Record<string, unknown> {
  return {
    count: s.count,
    sum: s.sum,
    mean: s.mean,
    median: s.median,
    min: s.min,
    max: s.max,
    stddev: s.stddev,
    q1: s.q1,
    q3: s.q3,
    iqr: s.iqr,
    outlier_count: s.outliers.length,
    outliers: s.outliers.map((o) => ({
      index: o.index,
      value: o.value,
      z_score: o.score,
      side: o.side,
    })),
  };
}

/** Compute the per-class performance row (canonical GPA engine per student). */
function classPerformanceRow(
  repos: Repositories,
  classId: string,
): ClassPerformanceRow | null {
  const cls = repos.classes.observeById(classId).get();
  if (!cls) return null;
  const students = repos.students.observeByClass(classId).get();
  const subjects = repos.subjects.observe().get();

  const gpas: number[] = [];
  let passing = 0;
  let atRisk = 0;
  for (const s of students) {
    const assessments = repos.grades.observeForStudent(s.id).get();
    const gpa = evaluateStudentTermPerformance(s.id, assessments, subjects);
    if (gpa.gpa !== null) {
      gpas.push(gpa.gpa);
      if (gpa.isPassing) passing++;
      else atRisk++;
    }
  }
  const stats = computeDescriptiveStats(gpas);
  return {
    classId: cls.id,
    className: cls.name,
    classCode: cls.code,
    level: cls.level,
    studentCount: students.length,
    evaluated: gpas.length,
    average: stats.mean,
    median: stats.median,
    spread: stats.q1 !== null && stats.q3 !== null ? Number((stats.q3 - stats.q1).toFixed(2)) : null,
    passRate: gpas.length > 0 ? Number(((passing / gpas.length) * 100).toFixed(1)) : null,
    atRiskCount: atRisk,
  };
}

/** Last-N-days ISO date window helper. */
function isoWindow(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/* ------------------------------------------------------------------ */
/*  Execution                                                          */
/* ------------------------------------------------------------------ */

export async function executeAnalysisTool(
  name: string,
  args: Record<string, unknown>,
  repos: Repositories,
): Promise<string> {
  switch (name) {
    /* ---------------- analyze_revenue_trends ---------------- */
    case "analyze_revenue_trends": {
      const res = await repos.dashboard.revenueLast12Months();
      if (!res.ok) return JSON.stringify({ error: "Impossible de lire la série de revenus." });
      const points = res.value;
      if (points.length === 0) {
        return JSON.stringify({ error: "Aucune donnée de revenu disponible." });
      }
      const window = Math.min(6, Math.max(2, Number(args.moving_average_window) || 3));
      const values = points.map((p) => p.amount);
      const ma = movingAverage(values, window);
      const growth = periodGrowthPercent(values);
      const trend = computeTrend(values);
      const sum = values.reduce((s, v) => s + v, 0);
      let bestIdx = 0;
      let worstIdx = 0;
      values.forEach((v, i) => {
        if (v > values[bestIdx]) bestIdx = i;
        if (v < values[worstIdx]) worstIdx = i;
      });

      const artifact: ChartArtifact = {
        kind: "chart",
        chartType: "line",
        title: "Revenus des 12 derniers mois (DZD)",
        categories: points.map((p) => p.label),
        series: [
          { name: "Revenu mensuel", data: values },
          { name: `Moyenne mobile ${window} mois`, data: ma.map((v) => v ?? 0) },
        ],
        unit: "DZD",
        caption: `Tendance ${trend.direction === "rising" ? "à la hausse" : trend.direction === "falling" ? "à la baisse" : "stable"} — variation totale ${trend.totalChangePercent !== null ? `${trend.totalChangePercent > 0 ? "+" : ""}${trend.totalChangePercent}%` : "n/a"}.`,
      };

      return withArtifact(
        {
          months: points.length,
          total_12m: sum,
          monthly_average: Number((sum / points.length).toFixed(0)),
          trend: {
            direction: trend.direction,
            slope_per_month: trend.slope,
            r_squared: trend.r2,
            total_change: trend.totalChange,
            total_change_percent: trend.totalChangePercent,
          },
          best_month: { label: points[bestIdx].label, amount: values[bestIdx] },
          worst_month: { label: points[worstIdx].label, amount: values[worstIdx] },
          series: points.map((p, i) => ({
            month: p.label,
            amount: p.amount,
            growth_vs_prev_percent: growth[i],
            moving_average: ma[i],
          })),
          guidance:
            "La moyenne mobile lisse la saisonnalité des inscriptions ; le R² mesure la fiabilité de la tendance linéaire (proche de 1 = tendance nette).",
        },
        artifact,
      );
    }

    /* ---------------- compute_statistics ---------------- */
    case "compute_statistics": {
      const dataset = String(args.dataset ?? "");
      const classId = typeof args.class_id === "string" ? args.class_id : "";

      let values: number[] = [];
      let label = "";
      let buckets = DZD_AMOUNT_BUCKETS;

      switch (dataset) {
        case "payment_amounts": {
          let payments = repos.payments.observe().get();
          const parentId = typeof args.parent_id === "string" ? args.parent_id : null;
          if (parentId) payments = repos.payments.observeByParent(parentId).get();
          values = payments.map((p) => p.amount);
          label = parentId ? "Montants des paiements (parent)" : "Montants des paiements (école)";
          break;
        }
        case "debt_amounts": {
          values = repos.debt.observeSummary().get().map((d) => d.outstandingAmount);
          label = "Créances en cours (par débiteur)";
          break;
        }
        case "class_gpas": {
          if (!classId) {
            return JSON.stringify({
              error: "Paramètre manquant : class_id est obligatoire pour le jeu class_gpas.",
              hint: "Utilisez search_entities avec entity_type=class pour trouver l'UUID de la classe.",
            });
          }
          const cls = repos.classes.observeById(classId).get();
          if (!cls) return JSON.stringify({ error: "Classe introuvable." });
          const students = repos.students.observeByClass(classId).get();
          const subjects = repos.subjects.observe().get();
          values = students
            .map((s) =>
              evaluateStudentTermPerformance(s.id, repos.grades.observeForStudent(s.id).get(), subjects).gpa,
            )
            .filter((g): g is number => g !== null);
          label = `Moyennes des élèves — ${cls.name}`;
          buckets = GPA_BUCKETS;
          break;
        }
        case "attendance_rates": {
          if (!classId) {
            return JSON.stringify({
              error: "Paramètre manquant : class_id est obligatoire pour le jeu attendance_rates.",
              hint: "Utilisez search_entities avec entity_type=class pour trouver l'UUID de la classe.",
            });
          }
          const cls = repos.classes.observeById(classId).get();
          if (!cls) return JSON.stringify({ error: "Classe introuvable." });
          const students = repos.students.observeByClass(classId).get();
          const { from, to } = isoWindow(30);
          values = students
            .map((s) => calculateAttendanceRate(repos.attendance.observeByStudent(s.id, from, to).get()))
            .map((r) => Number((r * 100).toFixed(1)));
          label = `Taux d'assiduité (%) — ${cls.name} (30 j)`;
          buckets = [
            { label: "< 70%", min: 0, max: 70 },
            { label: "70–80%", min: 70, max: 80 },
            { label: "80–85%", min: 80, max: 85 },
            { label: "85–90%", min: 85, max: 90 },
            { label: "90–95%", min: 90, max: 95 },
            { label: "≥ 95%", min: 95, max: 100.001 },
          ];
          break;
        }
        default:
          return JSON.stringify({ error: `Jeu de données inconnu : ${dataset}` });
      }

      if (values.length === 0) {
        return JSON.stringify({ error: "Aucune donnée pour ce jeu — la population est vide." });
      }
      const stats = computeDescriptiveStats(values);
      const distribution = bucketize(values, buckets);

      const artifact: ChartArtifact = {
        kind: "chart",
        chartType: "bar",
        title: `Distribution — ${label}`,
        categories: distribution.map((b) => b.label),
        series: [{ name: "Effectif", data: distribution.map((b) => b.count) }],
        unit: "count",
        caption: `${values.length} observations ; borne atypique Tukey : ${stats.q1 !== null && stats.q3 !== null ? `[${Math.round(stats.q1 - 1.5 * (stats.iqr ?? 0))}, ${Math.round(stats.q3 + 1.5 * (stats.iqr ?? 0))}]` : "n/a"}.`,
      };

      return withArtifact(
        {
          dataset,
          label,
          ...statsToJson(stats),
          distribution,
          guidance:
            "L'écart interquartile (IQR) mesure la dispersion robuste ; les valeurs hors bornes de Tukey méritent une vérification.",
        },
        artifact,
      );
    }

    /* ---------------- detect_anomalies ---------------- */
    case "detect_anomalies": {
      const scope = String(args.scope ?? "");
      const classId = typeof args.class_id === "string" ? args.class_id : "";
      const parentId = typeof args.parent_id === "string" ? args.parent_id : "";

      if (scope === "payments") {
        let payments = repos.payments.observe().get();
        if (parentId) {
          const parent = repos.parents.observeById(parentId).get();
          if (!parent) return JSON.stringify({ error: "Parent introuvable." });
          payments = repos.payments.observeByParent(parentId).get();
        } else {
          payments = payments.slice(0, 200); // wire cap
        }
        const report = detectPaymentAnomalies(payments, repos.parents.observe().get());
        const artifact: ChartArtifact | null =
          report.anomalies.length > 0
            ? {
                kind: "chart",
                chartType: "bar",
                title: "Paiements atypiques détectés (DZD)",
                categories: report.anomalies.map((a) => a.receiptNumber),
                series: [{ name: "Montant", data: report.anomalies.map((a) => a.amount) }],
                unit: "DZD",
                caption: `Plage normale estimée : ${report.normalRange ? `${report.normalRange[0].toLocaleString("fr-FR")} – ${report.normalRange[1].toLocaleString("fr-FR")} DZD` : "n/a"}.`,
              }
            : null;

        const base: Record<string, unknown> = {
          scope,
          screened: report.screened,
          normal_range: report.normalRange,
          ...statsToJson(report.stats),
          anomaly_count: report.anomalies.length,
          anomalies: report.anomalies.map((a) => ({
            payment_id: a.paymentId,
            receipt: a.receiptNumber,
            parent_id: a.parentId,
            amount: a.amount,
            date: a.collectedAt,
            type: a.kind,
            z_score: a.zScore,
            explanation: a.explanation,
          })),
          guidance:
            "Vérifiez chaque anomalie avec get_payment_history avant toute contestation — un montant atypique peut être un règlement multi-tranches légitime.",
        };
        // No anomalies → data only (no visual); anomalies → data + chart.
        return artifact ? withArtifact(base, artifact) : JSON.stringify(base);
      }

      if (scope === "attendance") {
        if (!classId) {
          return JSON.stringify({
            error: "Paramètre manquant : class_id est obligatoire pour le scope attendance.",
            hint: "Utilisez search_entities avec entity_type=class pour cibler la classe.",
          });
        }
        const cls = repos.classes.observeById(classId).get();
        if (!cls) return JSON.stringify({ error: "Classe introuvable." });
        const students = repos.students.observeByClass(classId).get();
        const { from, to } = isoWindow(30);
        const cohort = students.map((s) => ({
          student: s,
          records: repos.attendance.observeByStudent(s.id, from, to).get(),
        }));
        const anomalies = detectAttendanceAnomalies(cohort);

        const artifact: ChartArtifact | null =
          anomalies.length > 0
            ? {
                kind: "chart",
                chartType: "bar",
                title: `Assiduité des élèves signalés — ${cls.name} (%)`,
                categories: anomalies.map((a) => a.studentName),
                series: [
                  { name: "Taux d'assiduité", data: anomalies.map((a) => Number((a.attendanceRate * 100).toFixed(1))) },
                ],
                unit: "percent",
                caption: `Moyenne de la classe : ${anomalies[0].classRate !== null ? (anomalies[0].classRate * 100).toFixed(1) : "n/a"}%.`,
              }
            : null;

        const base: Record<string, unknown> = {
          scope,
          class: { id: cls.id, name: cls.name, code: cls.code },
          window_days: 30,
          screened_students: students.length,
          anomaly_count: anomalies.length,
          anomalies,
          guidance:
            "Un écart > 1,5σ sous la moyenne de classe signale un décrochage naissant — croisez avec recommend_interventions pour le plan d'action.",
        };
        return artifact ? withArtifact(base, artifact) : JSON.stringify(base);
      }

      if (scope === "grades") {
        if (!classId) {
          return JSON.stringify({
            error: "Paramètre manquant : class_id est obligatoire pour le scope grades.",
            hint: "Utilisez search_entities avec entity_type=class pour cibler la classe.",
          });
        }
        const cls = repos.classes.observeById(classId).get();
        if (!cls) return JSON.stringify({ error: "Classe introuvable." });
        const students = repos.students.observeByClass(classId).get();
        const subjects = repos.subjects.observe().get();
        const rawAnomalies = detectGradeAnomalies(
          students.map((s) => ({
            studentId: s.id,
            assessments: repos.grades.observeForStudent(s.id).get(),
          })),
          subjects,
        );
        // Resolve student names (DATA-005: displayName-aware, never
        // hand-composed first+last).
        const studentName = (id: string) => {
          const s = students.find((st) => st.id === id);
          return s ? studentDisplayName(s) : id;
        };
        const anomalies = rawAnomalies.map((a) => ({
          ...a,
          student_name: studentName(a.studentId),
        }));

        const artifact: ChartArtifact | null =
          anomalies.length > 0
            ? {
                kind: "chart",
                chartType: "bar",
                title: `Chutes de notes par élève/matière — ${cls.name} (pts)`,
                categories: anomalies.map(
                  (a) => `${a.student_name} · ${a.subjectName}`,
                ),
                series: [{ name: "Écart vs profil personnel", data: anomalies.map((a) => Math.abs(a.gap ?? 0)) }],
                unit: "score",
                caption: "Écart négatif ≥ 4 points vs la moyenne personnelle de l'élève.",
              }
            : null;

        const base: Record<string, unknown> = {
          scope,
          class: { id: cls.id, name: cls.name, code: cls.code },
          screened_students: students.length,
          anomaly_count: anomalies.length,
          anomalies,
          guidance:
            "Une chute ciblée dans UNE matière (profil sinon correct) appelle un entretien matière, pas un redoublement.",
        };
        return artifact ? withArtifact(base, artifact) : JSON.stringify(base);
      }

      return JSON.stringify({ error: `Scope inconnu : ${scope}` });
    }

    /* ---------------- compare_classes ---------------- */
    case "compare_classes": {
      const requested = Array.isArray(args.class_ids) ? (args.class_ids as unknown[]) : null;
      let classIds: string[];
      if (requested && requested.length > 0) {
        classIds = requested.filter((id): id is string => typeof id === "string").slice(0, 10);
      } else {
        classIds = repos.classes.observe().get().map((c) => c.id).slice(0, 10);
      }
      if (classIds.length === 0) return JSON.stringify({ error: "Aucune classe à comparer." });

      const rows: ClassPerformanceRow[] = [];
      for (const id of classIds) {
        const row = classPerformanceRow(repos, id);
        if (row) rows.push(row);
      }
      if (rows.length === 0) return JSON.stringify({ error: "Classes introuvables." });
      const comparison = compareClassPerformance(rows);

      const evaluatedRows = rows.filter((r) => r.average !== null);
      const artifact: ChartArtifact = {
        kind: "chart",
        chartType: "bar",
        title: "Moyenne de classe (/20)",
        categories: evaluatedRows.map((r) => r.className),
        series: [{ name: "Moyenne", data: evaluatedRows.map((r) => r.average ?? 0) }],
        unit: "score",
        caption: comparison.dispersionNote,
      };

      return withArtifact(
        {
          class_count: rows.length,
          ranking: comparison.ranking.map((r, i) => ({ rank: i + 1, ...r })),
          best_class: comparison.best,
          weakest_class: comparison.weakest,
          dispersion_note: comparison.dispersionNote,
          guidance:
            "Comparez la moyenne ET la dispersion : une classe à moyenne correcte mais forte dispersion contient des élèves en échec silencieux.",
        },
        artifact,
      );
    }

    /* ---------------- get_enrollment_demographics ---------------- */
    case "get_enrollment_demographics": {
      const res = await repos.dashboard.demographics();
      if (!res.ok) return JSON.stringify({ error: "Impossible de lire la démographie." });
      const demo = res.value;

      const artifact: ChartArtifact = {
        kind: "chart",
        chartType: "bar",
        title: "Taux de remplissage par niveau (%)",
        categories: demo.capacity.map((c) => c.label),
        series: [{ name: "Remplissage", data: demo.capacity.map((c) => c.percent) }],
        unit: "percent",
        caption: "Inscrits / capacité — 100% = niveau saturé.",
      };

      return withArtifact(
        {
          by_level: demo.grade,
          by_gender: demo.gender,
          by_age: demo.age,
          capacity_fill: demo.capacity.map((c) => ({
            level: c.label,
            enrolled: c.count,
            fill_rate_percent: c.percent,
          })),
          guidance:
            "Un niveau > 90% rempli anticipe la saturation d'inscriptions ; un niveau < 50% signale un vide de pipeline commercial.",
        },
        artifact,
      );
    }

    default:
      return JSON.stringify({ error: `Outil d'analyse inconnu : ${name}` });
  }
}
