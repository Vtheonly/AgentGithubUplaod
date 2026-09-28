/**
 * ER-PMAE cluster validation — identity-rules §6.1–6.2 (T-438 / ADR-032).
 *
 * Approved/confirmed identity edges form an undirected weighted graph.
 * Simple transitivity is FORBIDDEN as a merge basis (the snowball trap):
 * before a ≥ 3-node connected component is accepted as one person, its edge
 * density must clear the floor; otherwise the weakest edge (the bridge) is
 * cut and the component splits — recursively (INV-52).
 *
 * Pure graph walks over adjacency maps — no external graph library
 * (ADR-032 decision 1).
 */
import { ER_CLUSTER_DENSITY_FLOOR } from "./types";

/** A lightweight undirected weighted edge. */
export interface GraphEdge {
  readonly u: string;
  readonly v: string;
  readonly weight: number;
}

/** Connected components over the active edge set (node ids arbitrary strings). */
export function connectedComponents(
  nodes: readonly string[],
  edges: readonly GraphEdge[],
): readonly ReadonlySet<string>[] {
  const adjacency = new Map<string, Set<string>>();
  for (const n of nodes) adjacency.set(n, new Set());
  for (const { u, v } of edges) {
    if (u === v) continue;
    adjacency.get(u)?.add(v);
    adjacency.get(v)?.add(u);
  }
  const visited = new Set<string>();
  const components: ReadonlySet<string>[] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    const component = new Set<string>();
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cur = queue.pop() as string;
      component.add(cur);
      for (const next of adjacency.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Edge density inside a node set: actual / possible (complete-graph ratio). */
export function componentDensity(
  component: ReadonlySet<string>,
  edges: readonly GraphEdge[],
): number {
  const n = component.size;
  if (n <= 1) return 1;
  const possible = (n * (n - 1)) / 2;
  const inner = new Set<string>();
  for (const { u, v } of edges) {
    if (u !== v && component.has(u) && component.has(v)) {
      inner.add(u < v ? `${u}|${v}` : `${v}|${u}`);
    }
  }
  return inner.size / possible;
}

/**
 * Validate/cut the cluster graph (identity-rules §6.2).
 *
 * Returns the ACCEPTED clusters (each a set of node ids) after recursively
 * cutting bridges from any component whose density is below the floor.
 * Components of size ≤ 2 are always accepted (a pair's density is 1.0 when
 * its edge exists — the pair IS the evidence).
 */
export function resolveClusters(
  nodes: readonly string[],
  edges: readonly GraphEdge[],
  densityFloor: number = ER_CLUSTER_DENSITY_FLOOR,
): readonly ReadonlySet<string>[] {
  // Group the edges per component; walk each component independently.
  const components = connectedComponents(nodes, edges);
  const accepted: Array<ReadonlySet<string>> = [];
  for (const component of components) {
    accepted.push(...validateComponent(component, edges, densityFloor));
  }
  return accepted;
}

function validateComponent(
  component: ReadonlySet<string>,
  edges: readonly GraphEdge[],
  densityFloor: number,
): ReadonlyArray<ReadonlySet<string>> {
  const size = component.size;
  // Trivially accepted shapes.
  if (size <= 2) return [component];
  const density = componentDensity(component, edges);
  if (density >= densityFloor) return [component];
  // Below the floor: cut the WEAKEST inner edge (the bridge), then recurse
  // on the two resulting subgraphs. Deterministic tie-break: lowest weight,
  // then lexicographic (u,v) — stable across runs.
  const innerEdges = edges
    .filter((e) => e.u !== e.v && component.has(e.u) && component.has(e.v))
    .map((e) => ({ ...e, key: e.u < e.v ? `${e.u}|${e.v}` : `${e.v}|${e.u}` }))
    .sort((x, y) => x.weight - y.weight || (x.key < y.key ? -1 : 1));
  if (innerEdges.length === 0) {
    // No inner edge at all (an impossible shape after connectedComponents,
    // but fail safe): every node its own cluster.
    return [...component].map((n) => new Set([n]));
  }
  const bridge = innerEdges[0];
  const remaining = edges.filter((e) => e !== bridge && !(e.u === bridge.u && e.v === bridge.v));
  // Recurse on the subgraph — connectedComponents performs the split.
  return resolveClusters([...component], remaining, densityFloor);
}
