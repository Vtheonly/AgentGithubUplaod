/**
 * T-295 (OFFLINE-400) — the field-level diff engine test suite.
 *
 * Covers the mandate's explicit vectors: nested objects, arrays, primitives,
 * and null — plus the boundary semantics (absent vs null vs ""), the
 * deep-equal fast path, cycle safety, and the display formatting used by
 * the drawer (T-296) and the 3-way resolver (T-298).
 *
 * Run:
 *   npx vitest run src/tests/domain/field-diff.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeFieldDiff,
  flattenDiffRows,
  formatDiffValue,
  countChanges,
  deepEqual,
  ABSENT,
} from "../../domain/calc/diff/field-diff";

describe("computeFieldDiff — flat objects", () => {
  it("returns [] for structurally equal snapshots (deep-equal fast path)", () => {
    const before = { a: 1, b: "x", c: null };
    const after = { c: null, b: "x", a: 1 }; // different key ORDER — still equal
    expect(computeFieldDiff(before, after)).toEqual([]);
  });

  it("detects a single changed primitive field", () => {
    const nodes = computeFieldDiff(
      { status: "pending", amount: 2500000 },
      { status: "paid", amount: 2500000 },
    );
    const rows = flattenDiffRows(nodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: "status",
      kind: "changed",
      oldDisplay: "pending",
      newDisplay: "paid",
    });
  });

  it("detects multiple changed fields deterministically (sorted key order)", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(
        { zeta: 1, alpha: 2, mid: 3 },
        { zeta: 9, alpha: 2, mid: 8 },
      ),
    );
    expect(rows.map((r) => r.path)).toEqual(["mid", "zeta"]); // sorted, only changed
  });

  it("null → \"\" is a real change (boundary semantics)", () => {
    const rows = flattenDiffRows(computeFieldDiff({ note: null }, { note: "" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "changed", oldDisplay: "null", newDisplay: '""' });
  });

  it("absent key vs present-with-null is a real change (added, not changed)", () => {
    const rows = flattenDiffRows(computeFieldDiff({ a: 1 }, { a: 1, b: null }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "b", kind: "added", oldDisplay: "—", newDisplay: "null" });
  });

  it("present-with-null vs absent key is a removal (not a null change)", () => {
    const rows = flattenDiffRows(computeFieldDiff({ a: 1, b: null }, { a: 1 }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "b", kind: "removed", oldDisplay: "null", newDisplay: "—" });
  });

  it("boolean and number type changes are detected", () => {
    const rows = flattenDiffRows(
      computeFieldDiff({ active: 1, score: 10 }, { active: true, score: 10.5 }),
    );
    expect(rows.map((r) => r.path).sort()).toEqual(["active", "score"]);
    expect(rows.find((r) => r.path === "active")).toMatchObject({
      oldDisplay: "1",
      newDisplay: "true",
    });
  });
});

describe("computeFieldDiff — INSERT / DELETE semantics", () => {
  it("INSERT (before null): every top-level field renders as added/green", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(null, { id: "p1", name: "Ahmed", amount: 1000 }),
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "added")).toBe(true);
    expect(rows.every((r) => r.oldDisplay === "—")).toBe(true);
  });

  it("DELETE (after null): every top-level field renders as removed/red", () => {
    const rows = flattenDiffRows(
      computeFieldDiff({ id: "p1", name: "Ahmed" }, null),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "removed")).toBe(true);
    expect(rows.every((r) => r.newDisplay === "—")).toBe(true);
  });

  it("both sides null → no changes", () => {
    expect(computeFieldDiff(null, null)).toEqual([]);
    expect(computeFieldDiff(undefined, null)).toEqual([]);
  });

  it("INSERT of a nested object: per-field green rows under the container path", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(null, {
        parent: { firstName: "A", lastName: "B" },
        status: "active",
      }),
    );
    // parent.firstName + parent.lastName (green) + status (green)
    expect(rows.map((r) => r.path).sort()).toEqual(["parent.firstName", "parent.lastName", "status"]);
    expect(rows.every((r) => r.kind === "added")).toBe(true);
  });
});

describe("computeFieldDiff — nested objects", () => {
  it("recurses into changed nested objects with dotted paths", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(
        { parent: { firstName: "Ahmed", contact: { phone: "+2131" } } },
        { parent: { firstName: "Ahmed", contact: { phone: "+2132" } } },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: "parent.contact.phone",
      kind: "changed",
      oldDisplay: "+2131",
      newDisplay: "+2132",
    });
  });

  it("a nested object ADDED wholesale renders per-field green rows", () => {
    const rows = flattenDiffRows(
      computeFieldDiff({ meta: null }, { meta: { source: "excel", row: 42 } }),
    );
    expect(rows.map((r) => r.path).sort()).toEqual(["meta.row", "meta.source"]);
    expect(rows.every((r) => r.kind === "added")).toBe(true);
  });

  it("a nested object REMOVED wholesale renders per-field red rows", () => {
    const rows = flattenDiffRows(
      computeFieldDiff({ meta: { source: "excel" }, keep: 1 }, { keep: 1 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "meta.source", kind: "removed" });
  });

  it("scalar → object shape change renders as a whole-value change (no crash)", () => {
    const rows = flattenDiffRows(computeFieldDiff({ x: 5 }, { x: { deep: 1 } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "x", kind: "changed", oldDisplay: "5", newDisplay: "{…} 1 champ" });
  });

  it("deeply-nested triple-level change", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(
        { a: { b: { c: { d: 1 } } } },
        { a: { b: { c: { d: 2 } } } },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("a.b.c.d");
    expect(rows[0].oldDisplay).toBe("1");
    expect(rows[0].newDisplay).toBe("2");
  });

  it("unchanged siblings inside the same container are not reported", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(
        { payer: { name: "A", phone: "1", email: "a@b.c" } },
        { payer: { name: "B", phone: "1", email: "a@b.c" } },
      ),
    );
    expect(rows.map((r) => r.path)).toEqual(["payer.name"]);
  });
});

describe("computeFieldDiff — arrays", () => {
  it("detects an in-place element change with bracketed index path", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(
        { installments: [{ id: "i1", amount: 100 }, { id: "i2", amount: 200 }] },
        { installments: [{ id: "i1", amount: 100 }, { id: "i2", amount: 250 }] },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("installments[1].amount");
    expect(rows[0]).toMatchObject({ kind: "changed", oldDisplay: "200", newDisplay: "250" });
  });

  it("array growth: tail entries render as added (green-only)", () => {
    const rows = flattenDiffRows(
      computeFieldDiff({ tags: ["a"] }, { tags: ["a", "b", "c"] }),
    );
    expect(rows.map((r) => r.path)).toEqual(["tags[1]", "tags[2]"]);
    expect(rows.every((r) => r.kind === "added")).toBe(true);
  });

  it("array shrink: tail entries render as removed (red-only)", () => {
    const rows = flattenDiffRows(
      computeFieldDiff({ tags: ["a", "b", "c"] }, { tags: ["a"] }),
    );
    expect(rows.map((r) => r.path)).toEqual(["tags[1]", "tags[2]"]);
    expect(rows.every((r) => r.kind === "removed")).toBe(true);
  });

  it("equal arrays of objects → no rows (deep equality inside arrays)", () => {
    expect(
      computeFieldDiff(
        { items: [{ a: 1 }, { b: [2, 3] }] },
        { items: [{ a: 1 }, { b: [2, 3] }] },
      ),
    ).toEqual([]);
  });

  it("nested object array element change recurses into the element", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(
        { entries: [{ id: 1, meta: { k: "old" } }] },
        { entries: [{ id: 1, meta: { k: "new" } }] },
      ),
    );
    expect(rows.map((r) => r.path)).toEqual(["entries[0].meta.k"]);
    expect(rows[0]).toMatchObject({ kind: "changed", oldDisplay: "old", newDisplay: "new" });
  });

  it("scalar array mixed with element change + tail growth", () => {
    const rows = flattenDiffRows(
      computeFieldDiff({ v: [1, 2] }, { v: [1, 9, 7] }),
    );
    expect(rows.map((r) => r.path + ":" + r.kind)).toEqual([
      "v[1]:changed",
      "v[2]:added",
    ]);
  });
});

describe("computeFieldDiff — cycle safety", () => {
  it("self-referencing identical structures do not blow the stack", () => {
    const before: Record<string, unknown> = { name: "x" };
    before.self = before;
    const after: Record<string, unknown> = { name: "x" };
    after.self = after;
    // The identity guard short-circuits; the name field is equal → no rows.
    const rows = flattenDiffRows(computeFieldDiff(before, after));
    expect(rows).toHaveLength(0);
  });
});

describe("formatDiffValue — display semantics", () => {
  it("formats each value class", () => {
    expect(formatDiffValue(ABSENT)).toBe("—");
    expect(formatDiffValue(null)).toBe("null");
    expect(formatDiffValue(undefined)).toBe("undefined");
    expect(formatDiffValue("paid")).toBe("paid");
    expect(formatDiffValue("")).toBe('""');
    expect(formatDiffValue(2500)).toBe("2500");
    expect(formatDiffValue(false)).toBe("false");
    expect(formatDiffValue([1, 2])).toBe("[…] 2 éléments");
    expect(formatDiffValue([1])).toBe("[…] 1 élément");
    expect(formatDiffValue({ a: 1 })).toBe("{…} 1 champ");
    expect(formatDiffValue({ a: 1, b: 2 })).toBe("{…} 2 champs");
  });
});

describe("deepEqual — reference vectors", () => {
  it("the canonical equality table", () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false); // key sets differ
    expect(deepEqual("a", "a")).toBe(true);
  });
});

describe("countChanges — badge summaries", () => {
  it("counts leaf changes across nesting", () => {
    const nodes = computeFieldDiff(
      { a: 1, nested: { x: 1, y: 2 }, arr: [1, 2, 3] },
      { a: 2, nested: { x: 1, y: 3 }, arr: [1, 2] },
    );
    // a changed + nested.y changed + arr[2] removed = 3
    expect(countChanges(nodes)).toBe(3);
  });
});

describe("audit-shaped integration vectors (the real before/after shapes)", () => {
  it("payment status transition with nested allocation objects", () => {
    // The exact shape the audit log records for payment.collect (0014 + 0033):
    const before = {
      id: "pay-001",
      parent_id: "par-001",
      status: "pending",
      amount: 2_500_000,
      allocation: { installments: [{ id: "i1", applied: 0 }] },
    };
    const after = {
      id: "pay-001",
      parent_id: "par-001",
      status: "paid",
      amount: 2_500_000,
      allocation: { installments: [{ id: "i1", applied: 2_500_000 }] },
    };
    const rows = flattenDiffRows(computeFieldDiff(before, after));
    expect(rows.map((r) => r.path)).toEqual([
      "allocation.installments[0].applied",
      "status",
    ]);
    const statusRow = rows.find((r) => r.path === "status")!;
    expect(statusRow.oldDisplay).toBe("pending");
    expect(statusRow.newDisplay).toBe("paid");
  });

  it("actor attribution fields (actor_id/actor_role) survive as ordinary fields", () => {
    const rows = flattenDiffRows(
      computeFieldDiff(
        { actor_id: "u1", actor_role: "clerk" },
        { actor_id: "u1", actor_role: "financial_officer" },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: "actor_role",
      kind: "changed",
      oldDisplay: "clerk",
      newDisplay: "financial_officer",
    });
  });
});
