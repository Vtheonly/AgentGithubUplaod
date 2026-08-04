/**
 * Kahn's algorithm — cycle detection in a directed graph (plan §10.02).
 *
 * Used by the DAG editor to validate workflows before save / deploy.
 * Per plan §18.04: "Run Kahn's algorithm on every canvas save, not just
 * on publish" + "Provide visual feedback (red edges) when a connection
 * would create a cycle".
 *
 * Returns the set of nodes + edges that participate in a cycle (if any),
 * so the UI can highlight them in red.
 */

export interface CycleDetectionResult {
  readonly hasCycle: boolean;
  readonly cycleNodeIds: ReadonlySet<string>;
  readonly cycleEdgeKeys: ReadonlySet<string>;
}

/** Compose an edge key as `${from}->${to}`. */
export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Detect cycles in a directed graph using Kahn's algorithm.
 *
 * Algorithm:
 *   1. Compute in-degree of every node.
 *   2. Initialize a queue with all nodes of in-degree 0.
 *   3. Repeatedly dequeue a node, "remove" it from the graph (decrement
 *      in-degree of its successors), enqueue any new in-degree-0 nodes.
 *   4. If the queue empties before all nodes are processed, the unprocessed
 *      nodes participate in a cycle.
 *
 * Self-loops (a -> a) are always cycles.
 *
 * Duplicate edges are de-duplicated (a -> b appearing twice is the same as
 * once for the purpose of cycle detection).
 *
 * Disconnected components are handled correctly — each component is
 * processed independently.
 *
 * @param nodes Array of `{ id }` (any extra fields are ignored)
 * @param edges Array of `{ from, to }` (any extra fields are ignored)
 */
export function detectCycle(
  nodes: readonly Readonly<{ id: string }>[],
  edges: readonly Readonly<{ from: string; to: string }>[],
): CycleDetectionResult {
  if (nodes.length === 0) {
    return { hasCycle: false, cycleNodeIds: new Set(), cycleEdgeKeys: new Set() };
  }

  // Build adjacency list + in-degree map.
  // Deduplicate edges using a Set of edge keys.
  const seenEdges = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    // Skip edges that reference unknown nodes (defensive — shouldn't happen
    // in practice but the algorithm should not throw on bad input).
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    const key = edgeKey(edge.from, edge.to);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    adjacency.get(edge.from)!.add(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Initialize queue with all in-degree-0 nodes.
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  // Process the queue.
  let processedCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processedCount++;
    for (const successor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(successor) ?? 0) - 1;
      inDegree.set(successor, newDeg);
      if (newDeg === 0) queue.push(successor);
    }
  }

  // If we processed every node, no cycle.
  if (processedCount === nodes.length) {
    return { hasCycle: false, cycleNodeIds: new Set(), cycleEdgeKeys: new Set() };
  }

  // Otherwise, the unprocessed nodes participate in a cycle.
  const cycleNodeIds = new Set<string>();
  for (const [id, deg] of inDegree.entries()) {
    if (deg > 0) cycleNodeIds.add(id);
  }

  // Edges that participate in the cycle: edges where both endpoints are
  // in cycleNodeIds. (Edges entering or leaving the cycle are not part of
  // the cycle itself.)
  const cycleEdgeKeys = new Set<string>();
  for (const edge of edges) {
    if (cycleNodeIds.has(edge.from) && cycleNodeIds.has(edge.to)) {
      cycleEdgeKeys.add(edgeKey(edge.from, edge.to));
    }
  }

  return {
    hasCycle: true,
    cycleNodeIds,
    cycleEdgeKeys,
  };
}
