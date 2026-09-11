/**
 * 3-way merge engine — OFFLINE-400 / T-298 (46th session, 2026-09-11).
 *
 * Powers the concurrent-edit conflict detection and resolution:
 *   BASE   = the server row as the local user saw it when the edit began
 *            (the queue entry's `basePayload`)
 *   LOCAL  = the queued mutation payload (the user's edit — "User A")
 *   REMOTE = the CURRENT server row fetched at push time ("User B" —
 *            another operator's edit that landed in the meantime)
 *
 * Semantics (the recursive 3-way merge):
 *   - local ≡ remote (convergent edit)        → take it (once)
 *   - base ≡ local (only remote changed)      → take remote
 *   - base ≡ remote (only local changed)      → take local
 *   - objects on all three sides              → recurse by sorted key union
 *   - arrays on all three sides, same length  → index-wise recursion
 *   - everything else (both changed, differ)  → CONFLICT at this path
 *
 * The result carries the auto-merged tree (conflicted paths hold the BASE
 * value as a placeholder) plus the flat conflict list — the resolver UI
 * renders the list as 3 columns with the T-295 red/green field rows and
 * `resolveThreeWay` applies the per-field choices (take-local /
 * take-remote / manual value).
 *
 * Design rules (same doctrine as field-diff.ts):
 *   - PURE functions — no I/O, no React, no Supabase.
 *   - Reuses deepEqual/formatDiffValue from the T-295 engine — ONE
 *     equality implementation, ONE display formatter (zero duplication).
 *   - Deterministic: sorted key order everywhere.
 *   - Cycle-safe: a WeakMap pair-guard on the recursion.
 */

import { deepEqual, formatDiffValue } from "./field-diff";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** One conflicting field path — both sides changed it, differently. */
export interface FieldConflict {
  /** Dotted (or bracketed) path from the snapshot root. */
  readonly path: string;
  /** The base value (what both users started from). */
  readonly baseValue: unknown;
  /** The local edit's value (User A). */
  readonly localValue: unknown;
  /** The remote/current server value (User B). */
  readonly remoteValue: unknown;
  /** Pre-formatted compact displays (the resolver columns render these). */
  readonly baseDisplay: string;
  readonly localDisplay: string;
  readonly remoteDisplay: string;
}

/** The 3-way computation result. */
export interface ThreeWayResult {
  /**
   * The auto-merged tree: every path changed by ONE side (or both sides
   * convergently) carries the merged value; every CONFLICTED path holds
   * the BASE value as a placeholder until `resolveThreeWay` applies the
   * user's choices.
   */
  readonly merged: unknown;
  /** Fields BOTH sides changed differently — the resolver's work list. */
  readonly conflicts: readonly FieldConflict[];
  /** Leaf paths the merge applied automatically (local-only or remote-only). */
  readonly autoMergedPaths: readonly string[];
}

/** One per-conflict resolution choice. */
export type ConflictChoice =
  | { readonly kind: "local" }
  | { readonly kind: "remote" }
  | { readonly kind: "manual"; readonly value: unknown };

/** Map of conflict path → the user's choice for that path. */
export type ConflictChoices = Record<string, ConflictChoice>;

/* ------------------------------------------------------------------ */
/*  The 3-way merge                                                    */
/* ------------------------------------------------------------------ */

/**
 * Compute the 3-way merge of base / local / remote.
 *
 * Any two of the three may be null/undefined (treated as absent) — e.g. a
 * locally-ADDED field that the remote also added differently conflicts as
 * two "added" values; a remotely-DELETED field the local side edited
 * conflicts as edit-vs-absent.
 */
export function computeThreeWay(
  base: unknown,
  local: unknown,
  remote: unknown,
): ThreeWayResult {
  const conflicts: FieldConflict[] = [];
  const autoMergedPaths: string[] = [];
  const merged = mergeNode(base, local, remote, "", conflicts, autoMergedPaths, new WeakMap());
  return { merged, conflicts, autoMergedPaths };
}

/**
 * Apply the user's per-field choices to a 3-way result and return the
 * final resolved value. Choices omitted for a conflict keep the BASE
 * placeholder (never a silent win for either side).
 */
export function resolveThreeWay(
  result: ThreeWayResult,
  choices: ConflictChoices,
): unknown {
  let resolved = result.merged;
  for (const conflict of result.conflicts) {
    const choice = choices[conflict.path];
    if (!choice) continue;
    const value =
      choice.kind === "local"
        ? conflict.localValue
        : choice.kind === "remote"
          ? conflict.remoteValue
          : choice.value;
    resolved = setAtPath(resolved, conflict.path, value);
  }
  return resolved;
}

/* ------------------------------------------------------------------ */
/*  Internal recursion                                                 */
/* ------------------------------------------------------------------ */

function mergeNode(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  conflicts: FieldConflict[],
  autoMergedPaths: string[],
  seen: WeakMap<object, object>,
): unknown {
  // All three sides are plain objects → recurse by sorted key union FIRST
  // (the per-key recursion applies the fast paths at LEAF level, so every
  // auto-applied path is recorded — a root-level short-circuit would skip
  // the bookkeeping the resolver's transparency line displays).
  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const lb = base as Record<string, unknown>;
    const ll = local as Record<string, unknown>;
    const lr = remote as Record<string, unknown>;
    // Cycle guard (mirrors field-diff.ts).
    const guard = ll as object;
    if (seen.get(guard) === (lr as object)) return base;
    seen.set(guard, lr as object);

    const out: Record<string, unknown> = {};
    const keys = [...new Set([...Object.keys(lb), ...Object.keys(ll), ...Object.keys(lr)])].sort();
    for (const key of keys) {
      const childPath = path === "" ? key : `${path}.${key}`;
      out[key] = mergeNode(lb[key], ll[key], lr[key], childPath, conflicts, autoMergedPaths, seen);
    }
    return out;
  }

  // Convergent: both sides made the SAME change → take it once.
  if (deepEqual(local, remote)) return local;
  // Only the remote side changed → take remote.
  if (deepEqual(base, local)) {
    if (path !== "") autoMergedPaths.push(path);
    return remote;
  }
  // Only the local side changed → take local.
  if (deepEqual(base, remote)) {
    if (path !== "") autoMergedPaths.push(path);
    return local;
  }

  // All three sides are arrays with the SAME length → index-wise.
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const ab = base as unknown[];
    const al = local as unknown[];
    const ar = remote as unknown[];
    if (al.length === ar.length) {
      const out: unknown[] = [];
      for (let i = 0; i < al.length; i++) {
        out.push(
          mergeNode(ab[i], al[i], ar[i], `${path}[${i}]`, conflicts, autoMergedPaths, seen),
        );
      }
      return out;
    }
    // Length changed on both sides differently → whole-array conflict.
    conflicts.push(makeConflict(path, base, local, remote));
    return base;
  }

  // Leaf / shape mismatch with BOTH sides changed → the conflict case.
  conflicts.push(makeConflict(path, base, local, remote));
  // Base placeholder in the merged tree (choices replace it).
  return base;
}

function makeConflict(path: string, base: unknown, local: unknown, remote: unknown): FieldConflict {
  return {
    path: path === "" ? "(racine)" : path,
    baseValue: base,
    localValue: local,
    remoteValue: remote,
    baseDisplay: formatDiffValue(base),
    localDisplay: formatDiffValue(local),
    remoteDisplay: formatDiffValue(remote),
  };
}

/* ------------------------------------------------------------------ */
/*  Path setter (resolveThreeWay's writer)                             */
/* ------------------------------------------------------------------ */

/**
 * Set `value` at a dotted/bracketed path inside a JSON-shaped tree,
 * creating intermediate containers when needed. Pure — returns a new tree.
 *
 * Path grammar (the same one field-diff.ts emits):
 *   "a.b.c"        → nested object keys
 *   "items[2].qty" → array index then object key
 */
export function setAtPath(root: unknown, path: string, value: unknown): unknown {
  const segments = parsePath(path);
  if (segments.length === 0) return value;
  return setSegments(root, segments, value);
}

function setSegments(node: unknown, segments: readonly PathSegment[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    if (head.type === "index") {
      const arr = asArray(node);
      const out = [...arr];
      while (out.length <= head.index) out.push(undefined);
      out[head.index] = value;
      return out;
    }
    const obj = asObject(node);
    return { ...obj, [head.key]: value };
  }
  if (head.type === "index") {
    const arr = asArray(node);
    const out = [...arr];
    while (out.length <= head.index) out.push(undefined);
    out[head.index] = setSegments(out[head.index], rest, value);
    return out;
  }
  const obj = asObject(node);
  return { ...obj, [head.key]: setSegments(obj[head.key], rest, value) };
}

interface PathSegment {
  readonly type: "key" | "index";
  readonly key: string;
  readonly index: number;
}

const SEGMENT_RE = /([^.\[\]]+)|\[(\d+)\]/g;

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let m: RegExpExecArray | null;
  SEGMENT_RE.lastIndex = 0;
  while ((m = SEGMENT_RE.exec(path)) !== null) {
    if (m[1] !== undefined) segments.push({ type: "key", key: m[1], index: -1 });
    else if (m[2] !== undefined) segments.push({ type: "index", key: m[2], index: Number(m[2]) });
  }
  return segments;
}

function asObject(node: unknown): Record<string, unknown> {
  return isPlainObject(node) ? { ...(node as Record<string, unknown>) } : {};
}

function asArray(node: unknown): unknown[] {
  return Array.isArray(node) ? [...(node as unknown[])] : [];
}

/** Is this value a plain object (not array, not null)? */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
