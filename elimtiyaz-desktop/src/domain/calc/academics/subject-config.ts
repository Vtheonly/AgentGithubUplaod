import {
  DEFAULT_GRADING_RECIPE,
  type GradingRecipe,
  type Subject,
  type SubjectConfiguration,
} from "../../model/academic";

/**
 * THE canonical subject-configuration resolver (ADR-018 / MATIERE-500).
 *
 * ONE resolution rule for every surface that needs a subject's coefficient,
 * identifier, passing grade, extracurricular flag or grading recipe —
 * replacing the fourteen scattered `a.coefficient || subject?.coefficient || 1`
 * fallback chains that resolved differently on different screens.
 *
 * Resolution order (ADR-018 §5):
 *   1. the assessment SNAPSHOT — handled at the call sites that have one
 *      (they pass `snapshot` when a row already carries its resolution);
 *   2. the context CONFIGURATION row matching (subject, level, year,
 *      direction) — exact direction first, then the 'general' row;
 *   3. the legacy `subjects` columns (the pre-0094 world, still seeded live);
 *   4. the hard default (coefficient 1, passing 10, recipe {1,1,2,0}).
 *
 * This module is cross-platform canonical: the website carries a verbatim
 * port (`src/lib/canonical/subject-config.ts`) and Android a mirror
 * (`core/SubjectConfig.kt`) — keep them in lockstep (ADR-002).
 */

/** What the resolver hands back — everything a surface needs, one source. */
export interface ResolvedSubjectContext {
  readonly coefficient: number;
  readonly subjectCode: string;
  readonly passingGrade: number;
  readonly isExtracurricular: boolean;
  readonly gradingRecipe: GradingRecipe;
  readonly weeklyHours: number | null;
  /** Which layer answered — for audit UIs and equivalence probes. */
  readonly source: "configuration" | "legacy-subject" | "default";
}

export interface ResolveSubjectContextInput {
  /** The canonical subject directory row (identity + legacy columns). */
  readonly subject: Subject | undefined;
  /** The context configuration rows for the tenant (pre-filtered or not). */
  readonly configurations: readonly SubjectConfiguration[];
  /** The academic level id of the context (the class's level). */
  readonly academicLevelId?: string | null;
  /** The academic year id of the context (the class's year). */
  readonly academicYearId?: string | null;
  /** The direction/filière of the context; defaults to 'general'. */
  readonly direction?: string;
  /**
   * The assessment-row snapshot (coefficient + component weights at entry).
   * When provided, the snapshot WINS — history is never re-resolved
   * (ADR-018 §3: non-retroactive).
   */
  readonly snapshot?: {
    readonly coefficient?: number | null;
    readonly coefficientDevoir1?: number | null;
    readonly coefficientDevoir2?: number | null;
    readonly coefficientExamen?: number | null;
    readonly coefficientCc?: number | null;
  } | null;
}

function normalizeRecipe(raw: unknown): GradingRecipe {
  if (raw == null || typeof raw !== "object") return DEFAULT_GRADING_RECIPE;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    devoir1: num(r.devoir1, DEFAULT_GRADING_RECIPE.devoir1),
    devoir2: num(r.devoir2, DEFAULT_GRADING_RECIPE.devoir2),
    examen: num(r.examen, DEFAULT_GRADING_RECIPE.examen),
    cc: num(r.cc, DEFAULT_GRADING_RECIPE.cc),
  };
}

export function resolveSubjectConfiguration(
  input: ResolveSubjectContextInput,
): ResolvedSubjectContext {
  const direction = input.direction ?? "general";
  const { subject, configurations } = input;

  // Layer 2 — the context configuration row.
  const matches = configurations.filter(
    (c) =>
      c.subjectId === input.subject?.id &&
      c.academicLevelId === input.academicLevelId &&
      c.academicYearId === input.academicYearId &&
      c.isActive,
  );
  const config =
    matches.find((c) => c.direction === direction) ??
    matches.find((c) => c.direction === "general");

  // Layer 3 — the legacy subject columns.
  const legacy: ResolvedSubjectContext = {
    coefficient: subject?.coefficient ?? 1,
    subjectCode: subject?.code ?? "",
    passingGrade: subject?.passingGrade ?? 10,
    isExtracurricular: subject?.isExtracurricular ?? false,
    gradingRecipe: DEFAULT_GRADING_RECIPE,
    weeklyHours: null,
    source: "default",
  };

  const resolved: ResolvedSubjectContext = config
    ? {
        coefficient: config.coefficient,
        subjectCode: config.subjectCode ?? subject?.code ?? "",
        passingGrade: config.passingGrade,
        isExtracurricular: config.isExtracurricular,
        gradingRecipe: normalizeRecipe(config.gradingRecipe),
        weeklyHours: config.weeklyHours,
        source: "configuration",
      }
    : subject
      ? { ...legacy, source: "legacy-subject" }
      : legacy;

  // Layer 1 — the snapshot wins (non-retroactive history).
  const s = input.snapshot;
  if (s == null) return resolved;
  const snapC = typeof s.coefficient === "number" && s.coefficient > 0 ? s.coefficient : null;
  const snapRecipe: GradingRecipe =
    s.coefficientDevoir1 == null &&
    s.coefficientDevoir2 == null &&
    s.coefficientExamen == null &&
    s.coefficientCc == null
      ? resolved.gradingRecipe
      : {
          devoir1: s.coefficientDevoir1 ?? DEFAULT_GRADING_RECIPE.devoir1,
          devoir2: s.coefficientDevoir2 ?? DEFAULT_GRADING_RECIPE.devoir2,
          examen: s.coefficientExamen ?? DEFAULT_GRADING_RECIPE.examen,
          cc: s.coefficientCc ?? DEFAULT_GRADING_RECIPE.cc,
        };
  return {
    ...resolved,
    coefficient: snapC ?? resolved.coefficient,
    gradingRecipe: snapRecipe,
  };
}

/**
 * The recipe-aware canonical subject average — the TS mirror of the SQL
 * trigger `compute_assessments_subject_average` (migration 0094):
 *
 *   subject_average = Σ(mark × weight) / Σ(weight)
 *
 * over the POSITIVE-weight components; every one of them must be present,
 * else the average is NOT computable (null — the T-336 honesty rule, never
 * a silent dash and never a zeros-coerced deflation).
 *
 * Bit-parity: integer (centi-scaled) math — mark_cents × weight_cents are
 * exact integers, the final Math.round matches PostgreSQL ROUND(numeric, 2)
 * at .xx5 boundaries, exactly like the historical engine it generalizes.
 */
export function computeSubjectAverageFromRecipe(
  devoir1: number | null,
  devoir2: number | null,
  examen: number | null,
  cc: number | null,
  recipe: GradingRecipe = DEFAULT_GRADING_RECIPE,
): number | null {
  if (devoir1 == null && devoir2 == null && examen == null && cc == null) {
    return null; // no component marks — nothing to compute
  }
  const w1 = Math.round(recipe.devoir1 * 100);
  const w2 = Math.round(recipe.devoir2 * 100);
  const w3 = Math.round(recipe.examen * 100);
  const wcc = Math.round(recipe.cc * 100);

  // A positive-weight component is REQUIRED.
  if (w1 > 0 && devoir1 == null) return null;
  if (w2 > 0 && devoir2 == null) return null;
  if (w3 > 0 && examen == null) return null;
  if (wcc > 0 && cc == null) return null;

  let weightedSumCents = 0;
  let totalWeightCents = 0;
  if (w1 > 0) {
    weightedSumCents += Math.round(devoir1! * 100) * w1;
    totalWeightCents += w1;
  }
  if (w2 > 0) {
    weightedSumCents += Math.round(devoir2! * 100) * w2;
    totalWeightCents += w2;
  }
  if (w3 > 0) {
    weightedSumCents += Math.round(examen! * 100) * w3;
    totalWeightCents += w3;
  }
  if (wcc > 0) {
    weightedSumCents += Math.round(cc! * 100) * wcc;
    totalWeightCents += wcc;
  }
  if (totalWeightCents === 0) return null;
  return Math.round(weightedSumCents / totalWeightCents) / 100;
}
