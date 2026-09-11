/**
 * Field-level diff engine — OFFLINE-400 / T-295 (46th session, 2026-09-11).
 *
 * Computes a structured, nestable field diff between two JSON snapshots
 * (`before_json` vs `after_json` in the audit log; Base vs A vs B in the
 * 3-way merge resolver). RED = Before/old value, GREEN = After/new value —
 * the visual convention is the CALLER's responsibility; this module only
 * produces the structure.
 *
 * Design rules (the 46th-session mandate + the project's zero-duplication
 * doctrine):
 *   - PURE functions — no I/O, no React, no Electron. Testable everywhere.
 *   - Nestable: objects recurse by sorted key order; arrays diff by index
 *     with added/removed tail semantics.
 *   - Boundary semantics at the leaves: null, undefined and "" are distinct
 *     VALUES (a field changing from null → "" is a real change), but a key
 *     that is absent vs present-with-undefined collapses to added/removed.
 *     A null → object transition renders as per-field ADDED rows (content
 *     appeared); object → null renders as per-field REMOVED rows.
 *   - Deep-equal short-circuit: structurally equal snapshots return []
 *     (the drawer renders "aucune différence").
 *   - Cycle-safe: pair-tracking in deepEqual + an identity map in the diff
 *     recursion guard self-referencing structures.
 *   - Deterministic: key order is sorted, so the output is stable across
 *     runs and platforms (the Android mirror relies on this).
 */

/** Kind of change at one field path. */
export type FieldDiffKind = "added" | "removed" | "changed";

/**
 * One node of the field diff tree.
 *
 * A node is EITHER a leaf change (kind set, oldValue/newValue set — one side
 * may be the ABSENT sentinel) OR a container with children (kind null — the
 * container itself did not change as a whole, its children did).
 */
export interface FieldDiffNode {
  /** Dotted path from the snapshot root ("" for the root itself). */
  readonly path: string;
  /** Field name (last path segment; the root renders as the object itself). */
  readonly field: string;
  /** Leaf change kind, or null when this node is only a container. */
  readonly kind: FieldDiffKind | null;
  /** Old value (ABSENT sentinel when kind === "added"). */
  readonly oldValue: unknown;
  /** New value (ABSENT sentinel when kind === "removed"). */
  readonly newValue: unknown;
  /** Nested changes (containers only; empty for leaves). */
  readonly children: readonly FieldDiffNode[];
}

/**
 * Sentinel distinguishing "the key was absent on that side" from
 * "the key was present with value null" — the drawer renders absent as
 * "—" while null renders as "null".
 */
export const ABSENT: unique symbol = Symbol("absent");
export type Absent = typeof ABSENT;

/* ------------------------------------------------------------------ */
/*  Deep equality (cycle-safe)                                         */
/* ------------------------------------------------------------------ */

/** Deep structural equality (JSON-shaped values; cycle-safe). */
export function deepEqual(a: unknown, b: unknown): boolean {
  return deepEqualInner(a, b, new Map());
}

function deepEqualInner(a: unknown, b: unknown, seen: Map<object, object>): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (ta !== "object") return false; // primitives already compared by ===
  const ja = a as Record<string, unknown> | unknown[];
  const jb = b as Record<string, unknown> | unknown[];
  // Cycle guard: this exact pair is already being compared upstream.
  if (seen.get(ja) === jb) return true;
  seen.set(ja, jb);
  if (Array.isArray(ja) || Array.isArray(jb)) {
    if (!Array.isArray(ja) || !Array.isArray(jb)) return false;
    if (ja.length !== jb.length) return false;
    for (let i = 0; i < ja.length; i++) {
      if (!deepEqualInner(ja[i], jb[i], seen)) return false;
    }
    return true;
  }
  const ka = Object.keys(ja).sort();
  const kb = Object.keys(jb).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqualInner(ja[ka[i]], jb[kb[i]], seen)) return false;
  }
  return true;
}

/** Is this value a plain object (not array, not null)? */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Is this value a container (plain object or array)? */
function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return typeof v === "object" && v !== null;
}

/** Join a parent path with a child segment (root renders as the segment). */
function joinPath(parent: string, segment: string | number): string {
  if (parent === "") return String(segment);
  return typeof segment === "number"
    ? `${parent}[${segment}]`
    : `${parent}.${segment}`;
}

/** Field label for a path (root renders as "(racine)"). */
function fieldLabel(path: string): string {
  if (path === "") return "(racine)";
  const parts = path.split(".");
  return parts[parts.length - 1];
}

/* ------------------------------------------------------------------ */
/*  The diff engine                                                    */
/* ------------------------------------------------------------------ */

/**
 * Compute the field-level diff between two JSON snapshots.
 *
 * @param before The old snapshot (null/undefined when the action is an INSERT).
 * @param after  The new snapshot (null/undefined when the action is a DELETE).
 * @returns The changed nodes (containers included only when they contain
 *          changes). Empty array = structurally equal (or both sides absent).
 */
export function computeFieldDiff(before: unknown, after: unknown): FieldDiffNode[] {
  return diffNodes(before, after, "", new WeakMap());
}

/** Internal recursive worker over two PRESENT values. */
function diffNodes(
  before: unknown,
  after: unknown,
  path: string,
  seen: WeakMap<object, object>,
): FieldDiffNode[] {
  // INSERT semantics: before absent/null → every present field is "added".
  if (before === null || before === undefined) {
    if (after === null || after === undefined) return [];
    return addedTree(after, path);
  }
  // DELETE semantics: after absent/null → every present field is "removed".
  if (after === null || after === undefined) {
    return removedTree(before, path);
  }

  // Both present. Object↔object or array↔array recurse; null↔container
  // collapses to added/removed content; everything else is a whole-value
  // leaf change (including shape changes scalar→object).
  if (isContainer(before) && isContainer(after)) {
    const bothArrays = Array.isArray(before) && Array.isArray(after);
    const bothObjects = !Array.isArray(before) && !Array.isArray(after);
    if (bothArrays || bothObjects) {
      if (before === after) return [];
      // Cycle guard for the diff recursion itself.
      if (seen.get(before) === after) return [];
      seen.set(before, after);

      if (bothArrays) {
        const children = diffArrays(before, after, path, seen);
        if (children.length === 0) return [];
        if (path === "") return children;
        return [
          { path, field: fieldLabel(path), kind: null, oldValue: before, newValue: after, children },
        ];
      }
      const b = before as Record<string, unknown>;
      const a = after as Record<string, unknown>;
      const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
      const children: FieldDiffNode[] = [];
      for (const key of keys) {
        const childPath = joinPath(path, key);
        const hasB = Object.prototype.hasOwnProperty.call(b, key);
        const hasA = Object.prototype.hasOwnProperty.call(a, key);
        children.push(
          ...diffValues(
            hasB ? b[key] : ABSENT,
            hasA ? a[key] : ABSENT,
            key,
            childPath,
            seen,
          ),
        );
      }
      if (children.length === 0) return [];
      if (path === "") return children;
      return [
        { path, field: fieldLabel(path), kind: null, oldValue: before, newValue: after, children },
      ];
    }
    // Array↔object shape mismatch: whole-value change (fall through).
  }

  // Leaf (or shape-incompatible) change.
  if (deepEqual(before, after)) return [];
  return [
    { path, field: fieldLabel(path), kind: "changed", oldValue: before, newValue: after, children: [] },
  ];
}

/** Diff a pair of values where one side may be the ABSENT sentinel. */
function diffValues(
  bv: unknown,
  av: unknown,
  field: string,
  path: string,
  seen: WeakMap<object, object>,
): FieldDiffNode[] {
  const hasB = bv !== ABSENT;
  const hasA = av !== ABSENT;

  if (!hasB && !hasA) return [];

  // Key appeared → its whole subtree is new (per-field green rows).
  if (!hasB) return addedTree(av, path, field);
  // Key disappeared → its whole subtree is gone (per-field red rows).
  if (!hasA) return removedTree(bv, path, field);

  if (deepEqual(bv, av)) return [];

  // null → container: the content appeared (per-field ADDED rows).
  if (bv === null && isContainer(av)) {
    return addedTree(av, path, field);
  }
  // container → null: the content vanished (per-field REMOVED rows).
  if (av === null && isContainer(bv)) {
    return removedTree(bv, path, field);
  }

  // Present on both sides, different → recurse when shapes allow.
  if (isContainer(bv) && isContainer(av)) {
    const bothArrays = Array.isArray(bv) && Array.isArray(av);
    const bothObjects = !Array.isArray(bv) && !Array.isArray(av);
    if (bothArrays || bothObjects) {
      const children = diffNodes(bv, av, path, seen);
      if (children.length === 0) return [];
      return [{ path, field, kind: null, oldValue: bv, newValue: av, children }];
    }
  }

  // Leaf change (scalar→scalar, scalar→object rendered as whole-value, …).
  return [{ path, field, kind: "changed", oldValue: bv, newValue: av, children: [] }];
}

/** Index-wise array diff with added/removed tail semantics. */
function diffArrays(
  before: readonly unknown[],
  after: readonly unknown[],
  path: string,
  seen: WeakMap<object, object>,
): FieldDiffNode[] {
  const children: FieldDiffNode[] = [];
  const shared = Math.min(before.length, after.length);

  for (let i = 0; i < shared; i++) {
    const bv = before[i];
    const av = after[i];
    if (deepEqual(bv, av)) continue;
    const childPath = joinPath(path, i);
    const field = `[${i}]`;
    if (isContainer(bv) && isContainer(av)) {
      const bothArrays = Array.isArray(bv) && Array.isArray(av);
      const bothObjects = !Array.isArray(bv) && !Array.isArray(av);
      if (bothArrays || bothObjects) {
        const nested = diffNodes(bv, av, childPath, seen);
        if (nested.length > 0) {
          children.push({
            path: childPath,
            field,
            kind: null,
            oldValue: bv,
            newValue: av,
            children: nested,
          });
        }
        continue;
      }
    }
    children.push({
      path: childPath,
      field,
      kind: "changed",
      oldValue: bv,
      newValue: av,
      children: [],
    });
  }

  // Grown: tail entries are added.
  for (let i = shared; i < after.length; i++) {
    children.push(...addedTree(after[i], joinPath(path, i), `[${i}]`));
  }
  // Shrunk: tail entries are removed.
  for (let i = shared; i < before.length; i++) {
    children.push(...removedTree(before[i], joinPath(path, i), `[${i}]`));
  }

  return children;
}

/* ------------------------------------------------------------------ */
/*  INSERT / DELETE subtrees                                           */
/* ------------------------------------------------------------------ */

/** Build the FLAT per-field "everything here is new" rows for an added value. */
function addedTree(value: unknown, path: string, field?: string): FieldDiffNode[] {
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      // An empty object still deserves one visible green row.
      return [leaf(path, field, "added", ABSENT, value)];
    }
    const out: FieldDiffNode[] = [];
    for (const key of keys) {
      out.push(...addedTree(value[key], joinPath(path, key), key));
    }
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [leaf(path, field, "added", ABSENT, value)];
    }
    const out: FieldDiffNode[] = [];
    value.forEach((item, i) => {
      out.push(...addedTree(item, joinPath(path, i), `[${i}]`));
    });
    return out;
  }
  return [leaf(path, field, "added", ABSENT, value)];
}

/** Build the FLAT per-field "everything here is gone" rows for a removed value. */
function removedTree(value: unknown, path: string, field?: string): FieldDiffNode[] {
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      return [leaf(path, field, "removed", value, ABSENT)];
    }
    const out: FieldDiffNode[] = [];
    for (const key of keys) {
      out.push(...removedTree(value[key], joinPath(path, key), key));
    }
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [leaf(path, field, "removed", value, ABSENT)];
    }
    const out: FieldDiffNode[] = [];
    value.forEach((item, i) => {
      out.push(...removedTree(item, joinPath(path, i), `[${i}]`));
    });
    return out;
  }
  return [leaf(path, field, "removed", value, ABSENT)];
}

/** Build one leaf node. */
function leaf(
  path: string,
  field: string | undefined,
  kind: FieldDiffKind,
  oldValue: unknown,
  newValue: unknown,
): FieldDiffNode {
  return {
    path,
    field: field ?? fieldLabel(path),
    kind,
    oldValue,
    newValue,
    children: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Display formatting                                                 */
/* ------------------------------------------------------------------ */

/**
 * Format a value for compact one-line display in the diff rows.
 * Objects → "{…} N champs", arrays → "[…] N éléments", strings stay raw,
 * null → "null", absent → "—".
 */
export function formatDiffValue(value: unknown): string {
  if (value === ABSENT) return "—";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value === "" ? '""' : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[…] ${value.length} élément${value.length === 1 ? "" : "s"}`;
  }
  if (isPlainObject(value)) {
    const n = Object.keys(value).length;
    return `{…} ${n} champ${n === 1 ? "" : "s"}`;
  }
  return String(value);
}

/** One flattened display row (leaf change with the full dotted path). */
export interface DiffRow {
  readonly path: string;
  readonly kind: FieldDiffKind;
  readonly oldDisplay: string;
  readonly newDisplay: string;
}

/**
 * Flatten the diff tree into display rows — one row per LEAF change with the
 * full dotted path. Container nodes (kind null) only propagate their
 * children. The drawer renders exactly these rows: old value red, new value
 * green.
 */
export function flattenDiffRows(nodes: readonly FieldDiffNode[]): DiffRow[] {
  const rows: DiffRow[] = [];
  function walk(node: FieldDiffNode): void {
    if (node.children.length === 0) {
      if (node.kind !== null) {
        rows.push({
          path: node.path,
          kind: node.kind,
          oldDisplay: formatDiffValue(node.oldValue),
          newDisplay: formatDiffValue(node.newValue),
        });
      }
      return;
    }
    for (const child of node.children) walk(child);
  }
  for (const node of nodes) walk(node);
  return rows;
}

/** Count total leaf changes under a node list (for badges / summaries). */
export function countChanges(nodes: readonly FieldDiffNode[]): number {
  return flattenDiffRows(nodes).length;
}
