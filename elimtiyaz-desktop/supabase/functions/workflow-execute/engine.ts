// ============================================================================
// workflow-execute/engine.ts — the PURE workflow DAG execution engine
// ============================================================================
// Task: T-224 (34th session) — ported from the desktop reference semantics
// (domain/calc/workflow/dry-run.ts + condition-evaluator.ts, T-221) so the
// SERVER engine and the client's dry-run predictions can never diverge.
//
// PURITY CONTRACT (what makes this file special):
//   - ZERO imports (no Deno APIs, no supabase-js, no Node built-ins): the
//     same file runs inside the Deno Edge Function (imported by index.ts)
//     AND inside the desktop vitest suite (imported directly by
//     src/tests/…/workflow-engine tests — REAL unit tests of the server
//     engine, not source guards). It must therefore stay
//     TypeScript-strict-clean with no ambient dependencies.
//   - Side effects are INJECTED: the engine never touches the network or
//     the database — every action node is executed through the
//     ActionHandler the caller provides (the EF wires the real executors:
//     notifications, tasks, emails, restrictions; tests wire fakes).
//   - Failures are honest: a failed action closes ONLY its downstream
//     branch (parallel branches continue); the final status is "failed"
//     and every failed node carries its error — nothing is swallowed.
//
// EXECUTION SEMANTICS (branch-aware, topological — mirrors dry-run.ts):
//   1. Kahn topological order; a cyclic graph is REJECTED before execution.
//   2. All edges start OPEN. A node executes only if it has no incoming
//      edges, is a trigger, or is fed by at least one OPEN edge.
//   3. A failing condition closes its own outgoing edges (downstream nodes
//      become "skipped" unless another open path feeds them).
//   4. route_switch opens ONLY the first route whose condition passes;
//      with no passing route all outputs close.
//   5. A skipped node closes its own outgoing edges (branch cascade).
//   6. Convergence: a node with several incoming edges executes ONCE if at
//      least one path is open (never twice).
//   7. A failed action closes its outgoing edges but does NOT abort the
//      walk — other branches keep executing; the run ends "failed".
//   8. wait_duration > waitInlineCapMs PARKS the run (returns "paused" +
//      resume_state) — persistence + resumption are the caller's job
//      (the EF writes workflow_pending_resumes; the scheduler re-enters).
//   9. The deadline (timeout guard) is checked before every node; a
//      breached deadline ends the run as "timeout" with the remaining
//      nodes recorded as skipped.
//  10. Unknown node type/subtype FAILS that node with a diagnosable error
//      (the walk continues elsewhere) — never a silent skip.
// ============================================================================

// ---------------------------------------------------------------------------
// Types — the persisted contract (migration 0012 comment + T-176 mapping)
// ---------------------------------------------------------------------------

export interface EngineNode {
  id: string;
  type: string;
  subtype?: string;
  label?: string;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
}

export interface EngineEdge {
  id?: string;
  source: string;
  target: string;
}

export interface EngineDefinition {
  nodes: EngineNode[];
  edges: EngineEdge[];
}

/** Entity context the conditions resolve against (dot-path lookup). */
export type EngineContext = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Registry — the 29-subtype taxonomy (pinned to the SQL validator + the
// desktop model by the workflow-dag-server-validation / engine tests)
// ---------------------------------------------------------------------------

export const NODE_TYPES: readonly string[] = ["trigger", "condition", "action", "delay", "transform"];

export const SUBTYPES_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  trigger: [
    "payment_overdue", "student_enrolled", "payment_recorded", "schedule",
    "absence_limit_exceeded", "manual_run", "grade_below_threshold",
    "payment_cleared_or_bounced", "document_expiration", "calendar_cron_event",
    "stock_level_critical",
  ],
  condition: [
    "debt_over_threshold", "payment_method_match", "student_status_match",
    "time_window", "route_switch",
  ],
  action: [
    "send_email", "apply_discount", "create_invoice", "push_notification",
    "log_audit", "send_whatsapp", "restrict_account", "dispatch_task",
    "generate_document", "account_adjustment",
  ],
  delay: ["wait_duration"],
  transform: ["database_query", "extract_field"],
};

// ---------------------------------------------------------------------------
// Validation (TS mirror of public.validate_workflow_dag, migration 0081)
// ---------------------------------------------------------------------------

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
  warnings: string[];
  nodeCount: number;
  edgeCount: number;
}

export function parseDefinition(raw: unknown): EngineDefinition | null {
  const obj = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (obj === null || typeof obj !== "object") return null;
  const def = obj as Record<string, unknown>;
  if (!Array.isArray(def.nodes) || !Array.isArray(def.edges)) return null;
  return { nodes: def.nodes as EngineNode[], edges: def.edges as EngineEdge[] };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function validateWorkflowDefinition(
  def: EngineDefinition | null,
  opts: { strict?: boolean } = {},
): ValidationOutcome {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (def === null) {
    return { valid: false, errors: ["definition must be an object with nodes[] and edges[]"], warnings, nodeCount: 0, edgeCount: 0 };
  }
  const { nodes, edges } = def;
  const nodeIds: string[] = [];
  const seenPairs = new Set<string>();
  const edgeIds: string[] = [];
  let triggerSeen = false;
  let i = 0;

  for (const node of nodes) {
    i++;
    if (node === null || typeof node !== "object") {
      errors.push(`node[${i - 1}] is not an object`);
      nodeIds.push(`§invalid${i}§`);
      continue;
    }
    const id = typeof node.id === "string" && node.id !== "" ? node.id : null;
    if (id === null) {
      errors.push(`node[${i - 1}] has an empty/missing id`);
      nodeIds.push(`§invalid${i}§`);
    } else if (nodeIds.includes(id)) {
      errors.push(`duplicate node id "${id}"`);
      nodeIds.push(id);
    } else {
      nodeIds.push(id);
    }
    const type = typeof node.type === "string" ? node.type : null;
    if (type === null || !NODE_TYPES.includes(type)) {
      errors.push(`node "${nodeIds[nodeIds.length - 1]}" has invalid type "${type ?? "§null§"}"`);
    } else {
      const subtype = typeof node.subtype === "string" && node.subtype !== "" ? node.subtype : null;
      if (subtype === null) {
        errors.push(`node "${nodeIds[nodeIds.length - 1]}" (type ${type}) is missing its subtype`);
      } else if (!(SUBTYPES_BY_TYPE[type] ?? []).includes(subtype)) {
        errors.push(`node "${nodeIds[nodeIds.length - 1]}": subtype "${subtype}" is not registered for type ${type}`);
      }
    }
    if (type === "trigger") triggerSeen = true;
  }

  i = 0;
  for (const edge of edges) {
    i++;
    if (edge === null || typeof edge !== "object") {
      errors.push(`edge[${i - 1}] is not an object`);
      continue;
    }
    const eid = typeof edge.id === "string" && edge.id !== "" ? edge.id : null;
    if (eid === null) {
      warnings.push(`edge[${i - 1}] has no id (tolerated — key is (source,target))`);
    } else if (edgeIds.includes(eid)) {
      errors.push(`duplicate edge id "${eid}"`);
    }
    if (eid !== null) edgeIds.push(eid);

    const source = typeof edge.source === "string" ? edge.source : null;
    const target = typeof edge.target === "string" ? edge.target : null;
    const edgeName = eid ?? `edge[${i - 1}]`;
    if (source === null || source === "" || !nodeIds.includes(source)) {
      errors.push(`edge "${edgeName}" references unknown source node "${source ?? "§null§"}"`);
    }
    if (target === null || target === "" || !nodeIds.includes(target)) {
      errors.push(`edge "${edgeName}" references unknown target node "${target ?? "§null§"}"`);
    }
    if (source !== null && source === target) {
      errors.push(`edge "${edgeName}" is a self-reference on node "${source}"`);
    }
    if (source !== null && target !== null && source !== target && nodeIds.includes(source) && nodeIds.includes(target)) {
      const pair = `${source}->${target}`;
      if (seenPairs.has(pair)) {
        errors.push(`duplicate edge between "${source}" and "${target}"`);
      } else {
        seenPairs.add(pair);
      }
    }
  }

  // Kahn cycle detection (kahn.ts port — in-degree walk with involved nodes).
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const pair of seenPairs) {
    const [from, to] = pair.split("->");
    adjacency.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) if (deg === 0) queue.push(id);
  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const next of adjacency.get(current) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  if (processed < nodeIds.length && nodeIds.length > 0) {
    const cycleNodes = [...inDegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
    errors.push(`cycle detected — ${cycleNodes.length} node(s) involved: ${cycleNodes.join(", ")} (Kahn)`);
  }

  // Trigger in-degree rule.
  for (const node of nodes) {
    if (node?.type === "trigger") {
      const fed = edges.some((e) => e?.target === node.id);
      if (fed) errors.push(`trigger node "${node.id}" has incoming edges — triggers must be roots`);
    }
  }

  if (opts.strict) {
    if (!triggerSeen && nodes.length > 0) {
      errors.push("workflow has no trigger node (required for publishing)");
    }
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const cfg = (node.config ?? {}) as Record<string, unknown>;
      if (node.type === "condition" && ["debt_over_threshold", "payment_method_match", "student_status_match"].includes(node.subtype ?? "")) {
        const cond = cfg.condition ?? cfg._condition;
        if (cond === undefined || cond === null) {
          if ("threshold" in cfg || "method" in cfg || "status" in cfg) {
            warnings.push(`node "${node.id}": legacy scalar condition config (no canonical condition tree)`);
          } else {
            errors.push(`node "${node.id}": condition node has no condition configured`);
          }
        } else if (typeof cond === "string") {
          const parsed = safeJsonParse(cond);
          if (parsed === null || !conditionValid(parsed)) {
            errors.push(`node "${node.id}": condition is a string but not a valid condition tree`);
          }
        } else if (!conditionValid(cond)) {
          errors.push(`node "${node.id}": malformed condition tree`);
        }
      }
      if (node.type === "condition" && node.subtype === "route_switch") {
        if (!Array.isArray(cfg.routes)) {
          errors.push(`node "${node.id}": route_switch has no routes configured`);
        } else {
          for (const route of cfg.routes) {
            if (route === null || typeof route !== "object" || !("condition" in (route as object))) {
              errors.push(`node "${node.id}": a route is missing its condition`);
            } else if (!conditionValid((route as Record<string, unknown>).condition)) {
              errors.push(`node "${node.id}": a route condition is malformed`);
            }
          }
        }
      }
      if (node.type === "delay" && node.subtype === "wait_duration") {
        const duration = readFiniteNumber(cfg.duration_ms);
        if (cfg.duration_ms === undefined) {
          errors.push(`node "${node.id}": wait_duration has no duration_ms`);
        } else if (duration === undefined || duration <= 0) {
          errors.push(`node "${node.id}": wait_duration must be a positive duration_ms`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, nodeCount: nodes.length, edgeCount: edges.length };
}

// ---------------------------------------------------------------------------
// Condition evaluation — ported VERBATIM from the desktop reference
// (domain/calc/workflow/condition-evaluator.ts, vault §10.05: a missing
// field evaluates to FALSE + a warning, NEVER an exception)
// ---------------------------------------------------------------------------

export type ConditionCombinator = "and" | "or" | "not";
export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";

export interface ComparisonNode {
  kind: "comparison";
  field: string;
  op: ComparisonOperator;
  value: unknown;
}

export interface LogicalNode {
  kind: "logic";
  combinator: ConditionCombinator;
  children: ConditionNode[];
}

export type ConditionNode = ComparisonNode | LogicalNode;

export interface ConditionResult {
  passed: boolean;
  warnings: string[];
}

export function resolveField(
  context: EngineContext,
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

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  if (isNumeric(a) && typeof b === "string" && b.trim() !== "" && Number(b) === a) return true;
  if (isNumeric(b) && typeof a === "string" && a.trim() !== "" && Number(a) === b) return true;
  return false;
}

function evaluateComparison(node: ComparisonNode, context: EngineContext, warnings: string[]): boolean {
  const resolved = resolveField(context, node.field);
  if (!resolved.found) {
    warnings.push(`Champ introuvable « ${node.field} » — condition évaluée à false (vault §10.05).`);
    return false;
  }
  const actual = resolved.value;
  const expected = node.value;
  switch (node.op) {
    case "==": return looseEquals(actual, expected);
    case "!=": return !looseEquals(actual, expected);
    case ">": case "<": case ">=": case "<=": {
      if (!isNumeric(actual) || !isNumeric(expected)) {
        warnings.push(`Comparaison ${node.op} non numérique sur « ${node.field} » (${typeof actual} vs ${typeof expected}) — condition évaluée à false.`);
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

function evaluateNode(node: ConditionNode, context: EngineContext, warnings: string[]): boolean {
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
      case "and": return children.every((c) => evaluateNode(c, context, warnings));
      case "or": return children.some((c) => evaluateNode(c, context, warnings));
      case "not":
        if (children.length === 0) {
          warnings.push("Opérateur NOT sans enfant — évalué à false.");
          return false;
        }
        return !evaluateNode(children[0], context, warnings);
      default:
        warnings.push("Combinateur inconnu — évalué à false.");
        return false;
    }
  }
  warnings.push("Type de nœud de condition inconnu — évalué à false.");
  return false;
}

export function evaluateConditionTree(
  root: ConditionNode | null | undefined,
  context: EngineContext,
): ConditionResult {
  const warnings: string[] = [];
  if (root === null || root === undefined) return { passed: true, warnings };
  let passed = false;
  try {
    passed = evaluateNode(root, context, warnings);
  } catch (e) {
    warnings.push(`Erreur interne de l'évaluateur: ${String(e)} — évalué à false.`);
    passed = false;
  }
  return { passed, warnings };
}

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
    return { kind: "comparison", field: obj.field, op: obj.op as ComparisonOperator, value: obj.value };
  }
  if (obj.kind === "logic" && typeof obj.combinator === "string") {
    const combinators: readonly string[] = ["and", "or", "not"];
    if (!combinators.includes(obj.combinator)) return null;
    const children = Array.isArray(obj.children)
      ? obj.children.map(parseConditionConfig).filter((c): c is ConditionNode => c !== null)
      : [];
    return { kind: "logic", combinator: obj.combinator as ConditionCombinator, children };
  }
  return null;
}

/** Structural validity used by validateWorkflowDefinition's strict mode. */
export function conditionValid(raw: unknown): boolean {
  return parseConditionConfig(raw) !== null;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface EngineActionOutcome {
  status: "succeeded" | "failed" | "skipped";
  output: Record<string, unknown>;
  auditNote: string;
  error?: string;
}

/** Side-effect executor the caller injects (EF: real actions; tests: fakes). */
export type ActionHandler = (
  node: EngineNode,
  context: EngineContext,
) => Promise<EngineActionOutcome>;

export interface EngineNodeResult {
  node_id: string;
  node_type: string;
  node_subtype: string;
  node_label?: string;
  status: "succeeded" | "failed" | "skipped";
  started_at: string;
  completed_at: string;
  duration_ms: number;
  output?: Record<string, unknown>;
  error?: string;
}

export interface PauseRequest {
  node_id: string;
  duration_ms: number;
  resume_after: string;
}

/** Serialized state persisted in workflow_pending_resumes.state (T-228). */
export interface EngineResumeState {
  parked_node_id: string;
  open_edge_keys: string[];
  executed_node_ids: string[];
  node_results: EngineNodeResult[];
  context: EngineContext;
  started_at: string;
}

export interface EngineRunResult {
  status: "succeeded" | "failed" | "timeout" | "paused";
  error_message: string | null;
  node_results: EngineNodeResult[];
  taken_edge_keys: string[];
  pause?: PauseRequest;
  resume_state?: EngineResumeState;
  /** Warnings collected across all condition evaluations (§10.05). */
  warnings: string[];
}

export interface EngineOptions {
  context: EngineContext;
  actions: ActionHandler;
  /** Wall-clock budget for THIS invocation (ms). Default 15000 (EF CPU limit headroom). */
  deadlineMs?: number;
  /** Hard cap on nodes walked (runaway guard). Default 500. */
  maxNodes?: number;
  /** Waits above this cap PARK the run instead of blocking the worker. Default 10000. */
  waitInlineCapMs?: number;
  /** Injectable clock for deterministic tests. Default real time. */
  now?: () => Date;
  /** Re-entry after a park: continue a previously-paused walk. */
  resume?: EngineResumeState;
  /** Streaming hook — called as each node result is produced (the EF persists progressively). */
  onNodeResult?: (result: EngineNodeResult) => void;
}

const DEFAULT_DEADLINE_MS = 15_000;
const DEFAULT_MAX_NODES = 500;
const DEFAULT_WAIT_INLINE_CAP_MS = 10_000;

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function readFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

/** Kahn topological order over the deduped edge set. Assumes acyclic (validate first). */
export function topologicalOrder(
  nodes: readonly EngineNode[],
  edges: readonly EngineEdge[],
): EngineNode[] {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    adjacency.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  const seen = new Set<string>();
  for (const e of edges) {
    if (!adjacency.has(e.source) || !adjacency.has(e.target)) continue;
    const key = edgeKey(e.source, e.target);
    if (seen.has(key)) continue;
    seen.add(key);
    adjacency.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) if (deg === 0) queue.push(id);
  const orderedIds: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    orderedIds.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const full: EngineNode[] = orderedIds.map((id) => byId.get(id)!);
  const ordered = new Set(orderedIds);
  for (const n of nodes) if (!ordered.has(n.id)) full.push(n);
  return full;
}

/**
 * Time-window guard (mirrors dry-run.evaluateTimeWindow): passes when the
 * evaluation instant falls on an allowed weekday within [startHour, endHour).
 */
function evaluateTimeWindow(
  config: Readonly<Record<string, unknown>>,
  context: EngineContext,
): { passed: boolean; note: string } {
  const nowMsRes = resolveField(context, "workflow.nowMs");
  const nowMsRaw = nowMsRes.found ? nowMsRes.value : undefined;
  const nowRes = resolveField(context, "workflow.now");
  const rawNow = nowRes.found ? nowRes.value : undefined;
  const now = new Date(
    typeof nowMsRaw === "number" && Number.isFinite(nowMsRaw)
      ? nowMsRaw
      : typeof rawNow === "string" || typeof rawNow === "number"
        ? rawNow as string | number
        : Date.now(),
  );
  const startHour = readFiniteNumber(config.startHour) ?? 8;
  const endHour = readFiniteNumber(config.endHour) ?? 16.5;
  const days = Array.isArray(config.days)
    ? (config.days as unknown[]).filter((d): d is number => typeof d === "number")
    : [0, 1, 2, 3, 4];
  const day = now.getDay();
  const hour = now.getHours() + now.getMinutes() / 60;
  const dayOk = days.includes(day);
  const hourOk = hour >= startHour && hour < endHour;
  const hhmm = (h: number) =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  return {
    passed: dayOk && hourOk,
    note: `Fenêtre ${hhmm(startHour)}–${hhmm(endHour)}, jours ${days.join(",")} · maintenant ${hhmm(hour)} (jour ${day}) → ${dayOk && hourOk ? "ouvert" : "fermé"}`,
  };
}

/** One route of a route_switch node (mirrors dry-run.parseSwitchRoutes). */
export interface SwitchRoute {
  label: string;
  condition: ConditionNode | null;
}

export function parseSwitchRoutes(raw: unknown): readonly SwitchRoute[] {
  if (!Array.isArray(raw)) return [];
  const routes: SwitchRoute[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    routes.push({
      label: typeof obj.label === "string" && obj.label.trim() !== "" ? obj.label : "Voie",
      condition: parseConditionConfig(obj.condition),
    });
  }
  return routes;
}

/**
 * Execute a (validated) workflow DAG.
 *
 * The engine NEVER throws for graph/condition problems — those are returned
 * as node-level failures / skipped results. Only a programmer error inside
 * the injected ActionHandler can propagate, and the caller catches it.
 */
export async function executeWorkflowDefinition(
  def: EngineDefinition,
  options: EngineOptions,
): Promise<EngineRunResult> {
  const clock = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const waitInlineCapMs = options.waitInlineCapMs ?? DEFAULT_WAIT_INLINE_CAP_MS;
  const startedAtIso = clock().toISOString();
  const deadlineAt = Date.now() + deadlineMs;

  // Context: the evaluation instant defaults to "now" unless the caller
  // (or a resume) provided one — the caller-provided instant ALWAYS wins.
  const baseWorkflow = (options.context.workflow as Record<string, unknown> | undefined) ?? {};
  const resumedWorkflow = (options.resume?.context.workflow as Record<string, unknown> | undefined) ?? {};
  const context: EngineContext = {
    ...(options.resume?.context ?? {}),
    ...options.context,
    workflow: {
      ...resumedWorkflow,
      ...baseWorkflow,
      nowMs: baseWorkflow.nowMs ?? resumedWorkflow.nowMs ?? clock().getTime(),
    },
  };

  const warnings: string[] = [];
  const nodeResults: EngineNodeResult[] = options.resume ? [...options.resume.node_results] : [];
  const executed = new Set<string>(options.resume?.executed_node_ids ?? []);
  const openEdges = new Set<string>();
  const takenEdgeKeys: string[] = [];

  for (const e of def.edges) {
    if (def.nodes.some((n) => n.id === e.source) && def.nodes.some((n) => n.id === e.target)) {
      openEdges.add(edgeKey(e.source, e.target));
    }
  }
  if (options.resume) {
    for (const k of options.resume.open_edge_keys) openEdges.add(k);
  }

  const order = topologicalOrder(def.nodes, def.edges);
  const incoming = new Map<string, EngineEdge[]>();
  const outgoing = new Map<string, EngineEdge[]>();
  for (const n of def.nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of def.edges) {
    if (incoming.has(e.target) && outgoing.has(e.source)) {
      incoming.get(e.target)!.push(e);
      outgoing.get(e.source)!.push(e);
    }
  }

  const record = (result: EngineNodeResult): void => {
    nodeResults.push(result);
    options.onNodeResult?.(result);
  };

  let failedCount = 0;
  let failureMessage: string | null = null;
  let timedOut = false;
  let pause: PauseRequest | null = null;
  let resumeState: EngineResumeState | null = null;

  for (const node of order) {
    // Resume re-entry: nodes that already ran keep their recorded results.
    if (executed.has(node.id)) continue;
    if (nodeResults.length >= maxNodes) {
      record(skippedResult(node, clock(), { reason: "max_nodes_guard", max_nodes: maxNodes }));
      continue;
    }
    if (Date.now() > deadlineAt) {
      timedOut = true;
      record(skippedResult(node, clock(), { reason: "deadline_breached", deadline_ms: deadlineMs }));
      continue;
    }

    const feeders = incoming.get(node.id) ?? [];
    const reachable =
      feeders.length === 0 || node.type === "trigger" || feeders.some((e) => openEdges.has(edgeKey(e.source, e.target)));

    if (!reachable) {
      record(skippedResult(node, clock(), { reason: "branch_not_taken" }));
      for (const e of outgoing.get(node.id) ?? []) openEdges.delete(edgeKey(e.source, e.target));
      continue;
    }

    executed.add(node.id);
    const nodeStartIso = clock().toISOString();
    const nodeStartPerf = Date.now();

    // ---- condition nodes: branch semantics (dry-run parity) ----
    if (node.type === "condition") {
      const cfg = (node.config ?? {}) as Record<string, unknown>;
      const merged: EngineContext = { ...context, ...((cfg._context as Record<string, unknown>) ?? {}) };
      let keepOpen = true;
      let output: Record<string, unknown>;
      const error: string | undefined = undefined;

      if (node.subtype === "time_window") {
        const verdict = evaluateTimeWindow(cfg, merged);
        keepOpen = verdict.passed;
        output = { condition_result: verdict.passed, note: verdict.note, evaluated: "time_window" };
      } else if (node.subtype === "route_switch") {
        const routes = parseSwitchRoutes(cfg.routes);
        const targets = outgoing.get(node.id) ?? [];
        // Routes map to outgoing edges IN ORDER (route i → edge i).
        let chosenIdx = -1;
        const routeEvaluations: Record<string, unknown>[] = [];
        if (routes.length === 0) {
          chosenIdx = 0;
          warnings.push(`Aiguillage « ${node.label ?? node.id} » sans voies — première sortie par défaut.`);
        } else {
          for (let ri = 0; ri < routes.length; ri++) {
            const verdict = evaluateConditionTree(routes[ri].condition, merged);
            warnings.push(...verdict.warnings);
            routeEvaluations.push({ route: routes[ri].label, passed: verdict.passed });
            if (verdict.passed) {
              chosenIdx = ri;
              break;
            }
          }
        }
        output = { condition_result: chosenIdx >= 0, routes: routeEvaluations, evaluated: "route_switch" };
        // Open ONLY the chosen route's edge; close the others.
        for (let ti = 0; ti < targets.length; ti++) {
          const k = edgeKey(targets[ti].source, targets[ti].target);
          if (chosenIdx >= 0 && ti === chosenIdx) {
            takenEdgeKeys.push(k);
          } else {
            openEdges.delete(k);
          }
        }
        record(result(node, "succeeded", nodeStartIso, nodeStartPerf, clock, output, error));
        continue;
      } else {
        const tree = parseConditionConfig(cfg.condition ?? cfg._condition);
        if (tree === null && cfg.condition !== undefined && cfg.condition !== null) {
          // A configured-but-malformed condition: fail the NODE honestly
          // (the publish gate rejects this earlier; defense in depth).
          record(result(node, "failed", nodeStartIso, nodeStartPerf, clock,
            { condition_result: false, error: "malformed condition tree" },
            "condition is configured but malformed"));
          failedCount++;
          failureMessage = failureMessage ?? `Node '${node.id}' (condition) failed: malformed condition tree`;
          for (const e of outgoing.get(node.id) ?? []) openEdges.delete(edgeKey(e.source, e.target));
          continue;
        }
        const verdict = evaluateConditionTree(tree, merged);
        warnings.push(...verdict.warnings);
        keepOpen = verdict.passed;
        output = {
          condition_result: verdict.passed,
          warnings: verdict.warnings,
          evaluated: node.subtype ?? "condition",
        };
      }

      if (!keepOpen) {
        for (const e of outgoing.get(node.id) ?? []) openEdges.delete(edgeKey(e.source, e.target));
      } else {
        for (const e of outgoing.get(node.id) ?? []) {
          if (openEdges.has(edgeKey(e.source, e.target))) takenEdgeKeys.push(edgeKey(e.source, e.target));
        }
      }
      record(result(node, "succeeded", nodeStartIso, nodeStartPerf, clock, output, error));
      continue;
    }

    // ---- delay nodes: inline wait or PARK ----
    if (node.type === "delay" && node.subtype === "wait_duration") {
      const cfg = (node.config ?? {}) as Record<string, unknown>;
      const waitMs = readFiniteNumber(cfg.duration_ms) ?? 0;
      if (waitMs > waitInlineCapMs) {
        // PARK: hand the caller everything needed to resume later.
        const resumeAfter = new Date(Date.now() + waitMs);
        pause = {
          node_id: node.id,
          duration_ms: waitMs,
          resume_after: resumeAfter.toISOString(),
        };
        // The parked node itself is recorded as succeeded once RESUMED; for
        // now record it as succeeded-with-wait-pending so the partial run
        // shows the pause point (the scheduler replaces it on completion).
        record(result(node, "succeeded", nodeStartIso, nodeStartPerf, clock, {
          waited_ms: waitMs,
          parked: true,
          resume_after: resumeAfter.toISOString(),
          note: "parked — execution resumes via workflow_pending_resumes",
        }));
        resumeState = {
          parked_node_id: node.id,
          open_edge_keys: [...openEdges],
          executed_node_ids: [...executed],
          node_results: [...nodeResults],
          context,
          started_at: options.resume?.started_at ?? startedAtIso,
        };
        // The parked node's outgoing edges stay OPEN (the branch continues
        // after the delay elapses).
        break;
      }
      // Inline wait: delegate to the action handler (it decides how to wait,
      // capped by the engine).
      const outcome = await runHandler(options.actions, node, context);
      record(resultFromOutcome(node, outcome, nodeStartIso, nodeStartPerf, clock));
      if (outcome.status === "failed") {
        failedCount++;
        failureMessage = failureMessage ?? `Node '${node.id}' (delay) failed: ${outcome.error ?? "unknown"}`;
        for (const e of outgoing.get(node.id) ?? []) openEdges.delete(edgeKey(e.source, e.target));
      } else {
        for (const e of outgoing.get(node.id) ?? []) {
          if (openEdges.has(edgeKey(e.source, e.target))) takenEdgeKeys.push(edgeKey(e.source, e.target));
        }
      }
      continue;
    }

    // ---- trigger / action / transform nodes ----
    if (node.type === "trigger") {
      record(result(node, "succeeded", nodeStartIso, nodeStartPerf, clock, {
        trigger_type: node.subtype ?? node.type,
        note: "trigger entry point",
      }));
      for (const e of outgoing.get(node.id) ?? []) {
        if (openEdges.has(edgeKey(e.source, e.target))) takenEdgeKeys.push(edgeKey(e.source, e.target));
      }
      continue;
    }

    if (node.type === "action" || node.type === "transform") {
      // Unknown subtype → FAILED node with a diagnosable error (never silent).
      const known = (SUBTYPES_BY_TYPE[node.type] ?? []).includes(node.subtype ?? "");
      if (!node.subtype || !known) {
        record(result(node, "failed", nodeStartIso, nodeStartPerf, clock,
          { error: `unknown subtype '${node.subtype ?? "§missing§"}' for type ${node.type}` },
          `unknown subtype '${node.subtype ?? "§missing§"}' for type ${node.type}`));
        failedCount++;
        failureMessage = failureMessage ?? `Node '${node.id}' failed: unknown subtype '${node.subtype ?? "§missing§"}'`;
        for (const e of outgoing.get(node.id) ?? []) openEdges.delete(edgeKey(e.source, e.target));
        continue;
      }
      const outcome = await runHandler(options.actions, node, context);
      record(resultFromOutcome(node, outcome, nodeStartIso, nodeStartPerf, clock));
      if (outcome.status === "failed") {
        failedCount++;
        failureMessage = failureMessage ?? `Node '${node.id}' (${node.subtype}) failed: ${outcome.error ?? "unknown"}`;
        // Per-branch closure: ONLY this node's downstream closes.
        for (const e of outgoing.get(node.id) ?? []) openEdges.delete(edgeKey(e.source, e.target));
      } else {
        for (const e of outgoing.get(node.id) ?? []) {
          if (openEdges.has(edgeKey(e.source, e.target))) takenEdgeKeys.push(edgeKey(e.source, e.target));
        }
      }
      continue;
    }

    // Unknown type → failed node (defense in depth; validation catches it earlier).
    record(result(node, "failed", nodeStartIso, nodeStartPerf, clock,
      { error: `unknown node type '${node.type}'` }, `unknown node type '${node.type}'`));
    failedCount++;
    failureMessage = failureMessage ?? `Node '${node.id}' failed: unknown node type '${node.type}'`;
  }

  const status: EngineRunResult["status"] = pause
    ? "paused"
    : timedOut
      ? "timeout"
      : failedCount > 0
        ? "failed"
        : "succeeded";

  return {
    status,
    error_message: timedOut
      ? `execution deadline breached (${deadlineMs}ms)`
      : failureMessage,
    node_results: nodeResults,
    taken_edge_keys: takenEdgeKeys,
    ...(pause ? { pause } : {}),
    ...(resumeState ? { resume_state: resumeState } : {}),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function runHandler(
  handler: ActionHandler,
  node: EngineNode,
  context: EngineContext,
): Promise<EngineActionOutcome> {
  try {
    return await handler(node, context);
  } catch (err) {
    // The handler is not allowed to crash the walk — a throw becomes an
    // honest per-node failure (visible in node_results + error_message).
    return {
      status: "failed",
      output: { error: String(err) },
      auditNote: `handler threw: ${String(err)}`,
      error: String(err),
    };
  }
}

function skippedResult(
  node: EngineNode,
  at: Date,
  output: Record<string, unknown>,
): EngineNodeResult {
  return {
    node_id: node.id,
    node_type: node.type,
    node_subtype: node.subtype ?? "",
    node_label: node.label,
    status: "skipped",
    started_at: at.toISOString(),
    completed_at: at.toISOString(),
    duration_ms: 0,
    output: { ...output, skipped: true },
  };
}

function result(
  node: EngineNode,
  status: EngineNodeResult["status"],
  startedIso: string,
  startedPerf: number,
  clock: () => Date,
  output: Record<string, unknown>,
  error?: string,
): EngineNodeResult {
  return {
    node_id: node.id,
    node_type: node.type,
    node_subtype: node.subtype ?? "",
    node_label: node.label,
    status,
    started_at: startedIso,
    completed_at: clock().toISOString(),
    duration_ms: Math.max(0, Math.round(Date.now() - startedPerf)),
    output,
    ...(error !== undefined ? { error } : {}),
  };
}

function resultFromOutcome(
  node: EngineNode,
  outcome: EngineActionOutcome,
  startedIso: string,
  startedPerf: number,
  clock: () => Date,
): EngineNodeResult {
  return {
    node_id: node.id,
    node_type: node.type,
    node_subtype: node.subtype ?? "",
    node_label: node.label,
    status: outcome.status,
    started_at: startedIso,
    completed_at: clock().toISOString(),
    duration_ms: Math.max(0, Math.round(Date.now() - startedPerf)),
    output: { ...outcome.output, audit_note: outcome.auditNote },
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
  };
}
