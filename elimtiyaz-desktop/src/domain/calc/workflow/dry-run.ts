/**
 * Workflow dry-run simulator — T-221 (owner mandate "fully do the DAG
 * automations"; vault §10.02/§10.05 semantics), T-314 IF/ELSE branching.
 *
 * A PURE function that walks a workflow DAG in topological order and
 * simulates what the execution engine WOULD do, without writing anything:
 *
 *   1. Kahn topological order (reuse of `detectCycle`'s in-degree walk).
 *      A cyclic graph returns `{ ok: false }` — never throws.
 *   2. Branch-aware reachability: a node executes only if at least one
 *      incoming edge originates from an EXECUTED node whose branch is
 *      still "open":
 *        - an UNLABELED edge from a condition keeps the LEGACY GATE
 *          semantics: open iff the condition passes (a failing condition
 *          closes the edge — downstream nodes are "skipped");
 *        - T-314 IF/ELSE: an edge labeled `sourceHandle: "true"` (green
 *          port) opens iff the condition passes; an edge labeled
 *          `sourceHandle: "false"` (red port) opens iff it fails — the
 *          condition becomes a ROUTER that always sends execution down
 *          exactly one of the two labeled ports;
 *        - a `route_switch` opens ONLY the first route whose condition
 *          passes — every other outgoing edge is closed.
 *   3. Condition nodes are evaluated with the REAL Boolean tree evaluator
 *      (AND/OR/NOT + comparisons, missing fields → false + warning,
 *      never an exception — vault §10.05). T-314: each condition result
 *      carries a human-readable MATH EVALUATION (`explainConditionTree`)
 *      so the Test Studio can show `debt.amount (65 000) > 40 000 = VRAI`.
 *   4. `time_window` guards evaluate against `workflow.now` in the context
 *      (with the same true/false port routing as regular conditions).
 *   5. Triggers/actions/delays/transforms are simulated as succeeded
 *      (the dry-run never performs external effects). T-314: message
 *      actions carry `resolvedTemplate` — `{{debt.amount}}` resolved
 *      against the live context.
 *
 * The canvas uses the result to animate the taken path (green edges) and
 * per-node status rings; the mock repository executor reuses the same
 * engine to produce its run records so the visual semantics and the
 * execution semantics can never diverge (single source of truth).
 */
import { detectCycle } from "../../kahn";
import {
  evaluateConditionTree,
  explainConditionTree,
  parseConditionConfig,
  resolveTemplate,
  type ConditionContext,
  type ConditionNode,
} from "./condition-evaluator";
import type { WorkflowNode, WorkflowEdge, WorkflowNodeSubtype, WorkflowNodeType } from "../../model/workflow";

/** Per-node simulation outcome. */
export interface DryRunNodeResult {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly subtype: WorkflowNodeSubtype;
  readonly type: WorkflowNodeType;
  /**
   * `succeeded` = executed; `skipped` = branch not taken / unreachable.
   * `failed` = a real server-side failure (T-230: the server dry-run maps
   * the EF's failed nodes here; the LOCAL simulator never emits it).
   */
  readonly status: "succeeded" | "skipped" | "failed";
  /** Human-readable summary of what the node did (or why it was skipped). */
  readonly output: string;
  /** Vault §10.05 warnings (missing fields, non-numeric comparisons…). */
  readonly warnings: readonly string[];
  /**
   * T-314 (Test Studio): the MATH EVALUATION line for condition nodes —
   * `debt.amount (65 000) > 40 000 = VRAI`. Absent on non-conditions.
   */
  readonly evaluation?: string;
  /**
   * T-314 (Test Studio): a compact snapshot of the INPUT payload the node
   * evaluated against (payment / student / parent / debt key fields).
   */
  readonly inputSnapshot?: Readonly<Record<string, unknown>>;
  /**
   * T-314 (Test Studio): the node's message template with `{{fields}}`
   * RESOLVED against the context (send_whatsapp / send_email /
   * push_notification bodies). Absent when the node has no template.
   */
  readonly resolvedTemplate?: string;
}

export interface DryRunResult {
  /** False only when the graph is cyclic (or structurally invalid). */
  readonly ok: boolean;
  readonly error?: string;
  /** Results in topological execution order. */
  readonly results: readonly DryRunNodeResult[];
  /** Edge keys (`from->to`) whose path was actually TAKEN. */
  readonly takenEdgeKeys: readonly string[];
  /** The context the simulation ran against (useful for the UI preview). */
  readonly context: ConditionContext;
}

/** Options for the simulator. */
export interface DryRunOptions {
  /** Extra context layers merged OVER the base (per-node `_context` still wins). */
  readonly contextOverrides?: ConditionContext;
}

/** Edge key helper — same format as `kahn.edgeKey`. */
function keyOf(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Time-window guard (T-221 temporal condition): passes when the evaluation
 * instant falls on an allowed weekday within [startHour, endHour).
 * Config: `{ startHour: number, endHour: number, days: number[] }` where
 * days are JS getDay() indexes (0=Sunday … 6=Saturday); defaults to the
 * Algerian school week Sun–Thu, 08:00–16:30.
 */
function evaluateTimeWindow(
  config: Readonly<Record<string, unknown>>,
  context: ConditionContext,
): { passed: boolean; note: string } {
  const nowMsRaw = readField(context, "workflow.nowMs");
  const rawNow = readField(context, "workflow.now");
  const now =
    typeof nowMsRaw === "number" && Number.isFinite(nowMsRaw)
      ? new Date(nowMsRaw)
      : typeof rawNow === "string" || typeof rawNow === "number"
        ? new Date(rawNow)
        : new Date();
  const startHour = readNumber(config, "startHour") ?? 8;
  const endHour = readNumber(config, "endHour") ?? 16.5;
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

/* ---------------------------- small safe readers ---------------------------- */

function readField(source: Readonly<Record<string, unknown>>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readNumber(source: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const raw = source[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

/* ------------------------------- switch routes ------------------------------- */

/** One route of a `route_switch` node: label + condition tree. */
export interface SwitchRoute {
  readonly label: string;
  readonly condition: ConditionNode | null;
}

/**
 * Parse a switch node's `config.routes` — tolerant of malformed entries
 * (bad entries are dropped, never thrown). Shape:
 *   `[{ label: "Dette élevée", condition: { kind: "comparison", … } }]`
 */
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

/* ------------------------- T-314: condition port routing -------------------- */

/**
 * Handle-aware output routing shared by every condition flavor.
 *
 * LEGACY (all edges unlabeled): GATE — every edge opens iff `passed`.
 * T-314 IF/ELSE (labeled edges): the node becomes a binary ROUTER —
 *   - `sourceHandle: "true"`  → open iff `passed`  (green VRAI port);
 *   - `sourceHandle: "false"` → open iff `!passed` (red FAUX port).
 * A mixed config (labeled + unlabeled edges from the same condition) keeps
 * the gate rule for the unlabeled stragglers — predictable and documented.
 *
 * Returns true when at least one outgoing edge stayed open.
 */
function routeConditionOutputs(
  targets: readonly WorkflowEdge[],
  passed: boolean,
  openEdges: Set<string>,
  takenEdgeKeys: string[],
): boolean {
  let anyOpen = false;
  for (const e of targets) {
    const k = keyOf(e.from, e.to);
    if (e.sourceHandle === "false") {
      if (passed) {
        openEdges.delete(k);
      } else if (openEdges.has(k)) {
        takenEdgeKeys.push(k);
        anyOpen = true;
      } else {
        anyOpen = true;
      }
    } else if (e.sourceHandle === "true") {
      if (passed) {
        if (openEdges.has(k)) takenEdgeKeys.push(k);
        anyOpen = true;
      } else {
        openEdges.delete(k);
      }
    } else {
      // Legacy gate semantics for unlabeled edges.
      if (passed) {
        if (openEdges.has(k)) takenEdgeKeys.push(k);
        anyOpen = true;
      } else {
        openEdges.delete(k);
      }
    }
  }
  return anyOpen;
}

/* ------------------------- T-314: Test Studio helpers ---------------------- */

/** The message-bearing config keys of the communication action subtypes. */
const TEMPLATE_KEYS: readonly string[] = ["template", "body", "message"];

/** Extract the first message template found in an action's config. */
function readTemplate(config: Readonly<Record<string, unknown>>): string | null {
  for (const key of TEMPLATE_KEYS) {
    const raw = config[key];
    if (typeof raw === "string" && raw.includes("{{")) return raw;
  }
  return null;
}

/** Compact input-payload snapshot for the step inspector. */
function snapshotContext(context: ConditionContext): Record<string, unknown> {
  const pick = (key: string): unknown => {
    const raw = readField(context, key);
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === "object") {
      try {
        return JSON.parse(JSON.stringify(raw)) as unknown;
      } catch {
        return String(raw);
      }
    }
    return raw;
  };
  const out: Record<string, unknown> = {};
  for (const key of ["payment", "student", "parent", "debt"]) {
    const value = pick(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/* --------------------------------- the engine -------------------------------- */

/**
 * Simulate the execution of a workflow DAG against a context. PURE —
 * no writes, no timers, no exceptions.
 */
export function dryRunWorkflow(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  baseContext: ConditionContext,
  options: DryRunOptions = {},
): DryRunResult {
  const context: ConditionContext = {
    ...baseContext,
    ...(options.contextOverrides ?? {}),
    workflow: {
      ...(baseContext.workflow as Record<string, unknown> | undefined),
      ...((options.contextOverrides?.workflow as Record<string, unknown> | undefined) ?? {}),
      // The evaluation instant defaults to "now" but a caller-provided
      // instant (tests, scheduled replay) always WINS — never clobber it.
      nowMs:
        (options.contextOverrides?.workflow as Record<string, unknown> | undefined)?.nowMs ??
        (baseContext.workflow as Record<string, unknown> | undefined)?.nowMs ??
        Date.now(),
    },
  };

  // 1. Cycle check — the simulation never runs a cyclic graph.
  const cycle = detectCycle(nodes, edges);
  if (cycle.hasCycle) {
    return {
      ok: false,
      error: `Cycle détecté — ${cycle.cycleNodeIds.size} nœud(s) en boucle (Kahn). Simulation impossible.`,
      results: [],
      takenEdgeKeys: [],
      context,
    };
  }

  // 2. Topological order (Kahn). detectCycle gives us the verdict; the
  //    order itself is computed here with the same in-degree walk.
  const order = topologicalOrder(nodes, edges);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, WorkflowEdge[]>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    incoming.get(e.to)!.push(e);
    outgoing.get(e.from)!.push(e);
  }

  /** Edges currently OPEN (branch propagates through them). */
  const openEdges = new Set<string>(edges.map((e) => keyOf(e.from, e.to)));
  const results: DryRunNodeResult[] = [];
  const takenEdgeKeys: string[] = [];

  for (const node of order) {
    const feeders = incoming.get(node.id) ?? [];
    // Roots = trigger nodes AND any node with NO incoming edges (a lone
    // condition fragment is still meaningfully evaluable in a dry-run;
    // topological order keeps the result deterministic).
    const reachable =
      feeders.length === 0 || node.type === "trigger" || feeders.some((e) => openEdges.has(keyOf(e.from, e.to)));

    if (!reachable) {
      results.push({
        nodeId: node.id,
        nodeLabel: node.label,
        subtype: node.subtype,
        type: node.type,
        status: "skipped",
        output: "Branche non empruntée — aucune voie active n'alimente ce nœud.",
        warnings: [],
      });
      // A skipped node closes its own outgoing edges.
      for (const e of outgoing.get(node.id) ?? []) openEdges.delete(keyOf(e.from, e.to));
      continue;
    }

    const warnings: string[] = [];
    let output = `Exécuté (${node.subtype}) — simulé`;
    const inputSnapshot = snapshotContext(context);
    let evaluation: string | undefined;
    let resolvedTemplate: string | undefined;

    if (node.type === "condition") {
      const mergedContext: ConditionContext = {
        ...context,
        ...((node.config._context as Record<string, unknown> | undefined) ?? {}),
      };
      const targets = outgoing.get(node.id) ?? [];
      const hasLabeled = targets.some((e) => e.sourceHandle === "true" || e.sourceHandle === "false");
      let passed = true;

      if (node.subtype === "time_window") {
        const verdict = evaluateTimeWindow(node.config, mergedContext);
        passed = verdict.passed;
        evaluation = `${verdict.note} — ${verdict.passed ? "condition remplie" : "condition non remplie"}`;
        output = evaluation;
      } else if (node.subtype === "route_switch") {
        // Multi-way switch: open ONLY the first passing route's edge.
        const routes = parseSwitchRoutes(node.config.routes);
        let chosen: WorkflowEdge | null = null;
        if (routes.length === 0) {
          // No routes configured → default route (first edge) stays open.
          chosen = targets[0] ?? null;
          warnings.push("Aiguillage sans voies configurées — la première sortie est utilisée par défaut.");
        } else {
          // Routes map to outgoing edges IN ORDER (route i → edge i).
          for (let i = 0; i < routes.length; i++) {
            const route = routes[i];
            const verdict = evaluateConditionTree(route.condition, mergedContext);
            warnings.push(...verdict.warnings);
            if (verdict.passed) {
              chosen = targets[i] ?? null;
              output = `Voie « ${route.label} » retenue (voie ${i + 1}/${routes.length}).`;
              break;
            }
          }
          if (!chosen) {
            output = `Aucune voie ne correspond (${routes.length} voie(s) évaluée(s)) — sorties fermées.`;
          }
        }
        if (chosen) {
          for (const e of targets) {
            const k = keyOf(e.from, e.to);
            if (e.id === chosen.id) {
              takenEdgeKeys.push(k);
            } else {
              openEdges.delete(k);
            }
          }
        } else {
          for (const e of targets) openEdges.delete(keyOf(e.from, e.to));
        }
        results.push({
          nodeId: node.id,
          nodeLabel: node.label,
          subtype: node.subtype,
          type: node.type,
          status: "succeeded",
          output,
          warnings,
          inputSnapshot,
        });
        continue;
      } else {
        // Regular Boolean condition node.
        const tree = parseConditionConfig(node.config.condition ?? node.config._condition);
        const verdict = evaluateConditionTree(tree, mergedContext);
        warnings.push(...verdict.warnings);
        passed = verdict.passed;
        evaluation = explainConditionTree(tree, mergedContext);
        output = hasLabeled
          ? passed
            ? "Condition VRAI — le port TRUE (vert) est ouvert."
            : "Condition FAUX — le port FALSE (rouge) est ouvert."
          : verdict.passed
            ? "Condition remplie — la branche continue."
            : `Condition non remplie — la branche est bloquée. ${verdict.warnings.join(" ")}`.trim();
      }

      // T-314: handle-aware routing (true/false ports OR legacy gate).
      routeConditionOutputs(targets, passed, openEdges, takenEdgeKeys);

      results.push({
        nodeId: node.id,
        nodeLabel: node.label,
        subtype: node.subtype,
        type: node.type,
        status: "succeeded",
        output,
        warnings,
        ...(evaluation !== undefined ? { evaluation } : {}),
        inputSnapshot,
      });
      continue;
    }

    // Triggers / actions / delays / transforms: simulate success + enrich
    // message templates so the Test Studio shows RESOLVED strings.
    const template = readTemplate(node.config);
    if (template !== null) {
      resolvedTemplate = resolveTemplate(template, context);
      output = `Exécuté (${node.subtype}) — simulé · message résolu : « ${resolvedTemplate} »`;
    }

    // Record taken edges (source executed AND target reachable via an open edge).
    for (const e of outgoing.get(node.id) ?? []) {
      const k = keyOf(e.from, e.to);
      if (openEdges.has(k)) {
        takenEdgeKeys.push(k);
      }
    }

    results.push({
      nodeId: node.id,
      nodeLabel: node.label,
      subtype: node.subtype,
      type: node.type,
      status: "succeeded",
      output,
      warnings,
      ...(resolvedTemplate !== undefined ? { resolvedTemplate } : {}),
      inputSnapshot,
    });
  }

  return { ok: true, results, takenEdgeKeys, context };
}

/* ------------------------------ topology helper ------------------------------ */

/** Kahn topological order. Assumes acyclicity (call detectCycle first). Generic: returns the ORIGINAL node objects. */
export function topologicalOrder<T extends Readonly<{ id: string }>>(
  nodes: readonly T[],
  edges: readonly Readonly<{ from: string; to: string }>[],
): readonly T[] {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    adjacency.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  const seen = new Set<string>();
  for (const e of edges) {
    if (!adjacency.has(e.from) || !adjacency.has(e.to)) continue;
    const key = keyOf(e.from, e.to);
    if (seen.has(key)) continue;
    seen.add(key);
    adjacency.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
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
  // Defensive: nodes unreachable by the walk (shouldn't happen post
  // cycle-check) are appended so they still get a result row.
  const ordered = new Set(orderedIds);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const full: T[] = orderedIds.map((id) => byId.get(id)!);
  for (const n of nodes) if (!ordered.has(n.id)) full.push(n);
  return full;
}
