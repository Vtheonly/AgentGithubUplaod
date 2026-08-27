/**
 * Workflow condition evaluator — vault §10.05.
 *
 * Evaluates Boolean logic trees with the operators:
 *   AND, OR, NOT, >, <, >=, <=, ==, !=
 *
 * CRITICAL RULE (vault §10.05): "Always validate field availability before
 * evaluating. If a condition references a field that does not exist on the
 * entity (e.g. `student.gpa` on a parent record), the condition evaluator
 * must return `false` and log a warning — never throw an exception that
 * crashes the workflow."
 *
 * The evaluator is PURE: it collects warnings into the returned result
 * instead of logging side effects, so it is testable and runtime-safe.
 */

/** Logical combinators. */
export type ConditionCombinator = "and" | "or" | "not";

/** Comparison operators. */
export type ComparisonOperator =
  | ">"
  | "<"
  | ">="
  | "<="
  | "=="
  | "!=";

/** A comparison leaf: `field <op> value` (field resolved via dot-path). */
export interface ComparisonNode {
  readonly kind: "comparison";
  readonly field: string;
  readonly op: ComparisonOperator;
  readonly value: unknown;
}

/** A logical node combining children (or a single child for NOT). */
export interface LogicalNode {
  readonly kind: "logic";
  readonly combinator: ConditionCombinator;
  readonly children: readonly ConditionNode[];
}

export type ConditionNode = ComparisonNode | LogicalNode;

/** Entity context the fields resolve against (dot-path lookup). */
export type ConditionContext = Readonly<Record<string, unknown>>;

export interface ConditionResult {
  /** The evaluated truth value. Missing fields make comparisons FALSE. */
  readonly passed: boolean;
  /** Warnings collected during evaluation (missing fields, type mismatches). */
  readonly warnings: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Field resolution                                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve a dot-path (`student.absence_count`) against the context.
 * Returns `{ found: true, value }` or `{ found: false }` — NEVER throws,
 * even for weird paths.
 */
export function resolveField(
  context: ConditionContext,
  path: string,
): { found: true; value: unknown } | { found: false } {
  if (!path || typeof path !== "string") return { found: false };
  const parts = path.split(".");
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined) return { found: false };
    if (typeof current !== "object") return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) return { found: false };
  return { found: true, value: current };
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Boolean ↔ string ("true"/"false") comparisons for config ergonomics.
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a) === String(b);
  }
  // Numeric string vs number.
  if (isNumeric(a) && typeof b === "string" && b.trim() !== "" && Number(b) === a) return true;
  if (isNumeric(b) && typeof a === "string" && a.trim() !== "" && Number(a) === b) return true;
  return false;
}

function evaluateComparison(
  node: ComparisonNode,
  context: ConditionContext,
  warnings: string[],
): boolean {
  const resolved = resolveField(context, node.field);
  if (!resolved.found) {
    // CRITICAL RULE — unknown field: false + warning, never an exception.
    warnings.push(
      `Champ introuvable « ${node.field} » — condition évaluée à false (vault §10.05).`,
    );
    return false;
  }
  const actual = resolved.value;
  const expected = node.value;

  switch (node.op) {
    case "==":
      return looseEquals(actual, expected);
    case "!=":
      return !looseEquals(actual, expected);
    case ">":
    case "<":
    case ">=":
    case "<=": {
      if (!isNumeric(actual) || !isNumeric(expected)) {
        warnings.push(
          `Comparaison ${node.op} non numérique sur « ${node.field} » (${typeof actual} vs ${typeof expected}) — condition évaluée à false.`,
        );
        return false;
      }
      if (node.op === ">") return actual > expected;
      if (node.op === "<") return actual < expected;
      if (node.op === ">=") return actual >= expected;
      return actual <= expected;
    }
    default:
      warnings.push(`Opérateur inconnu « ${String(node.op)} » — condition évaluée à false.`);
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Tree evaluation                                                     */
/* ------------------------------------------------------------------ */

function evaluateNode(
  node: ConditionNode,
  context: ConditionContext,
  warnings: string[],
): boolean {
  if (!node || typeof node !== "object") {
    warnings.push("Nœud de condition invalide (null / non-objet) — évalué à false.");
    return false;
  }
  if (node.kind === "comparison") {
    return evaluateComparison(node, context, warnings);
  }
  if (node.kind === "logic") {
    const children = Array.isArray(node.children) ? node.children : [];
    switch (node.combinator) {
      case "and":
        return children.every((c) => evaluateNode(c, context, warnings));
      case "or":
        return children.some((c) => evaluateNode(c, context, warnings));
      case "not":
        if (children.length === 0) {
          warnings.push("Opérateur NOT sans enfant — évalué à false.");
          return false;
        }
        return !evaluateNode(children[0], context, warnings);
      default:
        warnings.push(`Combinateur inconnu — évalué à false.`);
        return false;
    }
  }
  warnings.push("Type de nœud de condition inconnu — évalué à false.");
  return false;
}

/**
 * Evaluate a Boolean condition tree against an entity context.
 * PURE — collects warnings, never throws, always returns a boolean verdict.
 */
export function evaluateConditionTree(
  root: ConditionNode | null | undefined,
  context: ConditionContext,
): ConditionResult {
  const warnings: string[] = [];
  if (root === null || root === undefined) {
    // No condition configured → trivially passes (no gate).
    return { passed: true, warnings };
  }
  let passed = false;
  try {
    passed = evaluateNode(root, context, warnings);
  } catch (e) {
    // Defense in depth — the evaluator is pure, but a corrupt tree must
    // never crash a workflow run.
    warnings.push(`Erreur interne de l'évaluateur: ${String(e)} — évalué à false.`);
    passed = false;
  }
  return { passed, warnings };
}

/* ------------------------------------------------------------------ */
/* Deserialization helper                                              */
/* ------------------------------------------------------------------ */

/**
 * Parse a stored condition config (JSON) into a ConditionNode tree.
 * Malformed configs return null (treated as "no gate" by the evaluator)
 * rather than throwing.
 */
export function parseConditionConfig(raw: unknown): ConditionNode | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return parseConditionConfig(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "comparison" && typeof obj.field === "string" && typeof obj.op === "string") {
    const ops: readonly string[] = [">", "<", ">=", "<=", "==", "!="];
    if (!ops.includes(obj.op)) return null;
    return {
      kind: "comparison",
      field: obj.field,
      op: obj.op as ComparisonOperator,
      value: obj.value,
    };
  }
  if (obj.kind === "logic" && typeof obj.combinator === "string") {
    const combinators: readonly string[] = ["and", "or", "not"];
    if (!combinators.includes(obj.combinator)) return null;
    const children = Array.isArray(obj.children)
      ? obj.children.map(parseConditionConfig).filter((c): c is ConditionNode => c !== null)
      : [];
    return {
      kind: "logic",
      combinator: obj.combinator as ConditionCombinator,
      children,
    };
  }
  return null;
}

/**
 * Build the default entity context for the mock workflow executor.
 * Seeds realistic values so conditions have something to evaluate against;
 * individual node configs may override via `config._context`.
 */
export function defaultConditionContext(now: Date = new Date()): ConditionContext {
  return {
    payment: {
      amount: 45_000,
      method: "check",
      status: "pending",
      category: "tuition",
      days_overdue: 0,
    },
    student: {
      absence_count: 2,
      status: "active",
      gpa: 12.5,
      has_medical_certificate: false,
    },
    parent: {
      outstanding_balance: 60_000,
      days_overdue: 45,
      is_financially_restricted: false,
    },
    debt: {
      amount: 60_000,
      threshold: 50_000,
      days_overdue: 45,
    },
    workflow: {
      now: now.toISOString(),
    },
  };
}
