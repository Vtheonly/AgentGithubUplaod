/**
 * T-298 (OFFLINE-400) — the pure 3-way merge engine suite.
 *
 * Vectors mirror the mandate's conflict semantics: both-changed-same-field
 * → conflict; disjoint changes → auto-merge; convergent edits collapse;
 * array edits; null transitions; resolution correctness (take-local /
 * take-remote / manual / omitted-keeps-base); nested-path application via
 * setAtPath; and the NO-SILENT-OVERWRITE guarantee (a both-sides divergence
 * ALWAYS yields a non-empty conflict list — the merge never picks a winner
 * on its own).
 */
import { describe, it, expect } from "vitest";
import {
  computeThreeWay,
  resolveThreeWay,
  setAtPath,
} from "../../domain/calc/diff/three-way";

const base = { status: "pending", amount: 1000, note: "n", flag: true };

describe("computeThreeWay — detection semantics", () => {
  it("both sides changed the SAME field differently → one conflict with all three values", () => {
    const local = { ...base, status: "paid" };
    const remote = { ...base, status: "cancelled" };
    const r = computeThreeWay(base, local, remote);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe("status");
    expect(r.conflicts[0].baseValue).toBe("pending");
    expect(r.conflicts[0].localValue).toBe("paid");
    expect(r.conflicts[0].remoteValue).toBe("cancelled");
    expect(r.conflicts[0].baseDisplay).toBe("pending");
    expect(r.conflicts[0].localDisplay).toBe("paid");
    expect(r.conflicts[0].remoteDisplay).toBe("cancelled");
  });

  it("disjoint changes auto-merge — local's field AND remote's field, zero conflicts", () => {
    const local = { ...base, status: "paid" };
    const remote = { ...base, amount: 2000 };
    const r = computeThreeWay(base, local, remote);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({ ...base, status: "paid", amount: 2000 });
    expect([...r.autoMergedPaths].sort()).toEqual(["amount", "status"]);
  });

  it("convergent edits (both made the SAME change) apply once, zero conflicts", () => {
    const local = { ...base, status: "paid" };
    const remote = { ...base, status: "paid" };
    const r = computeThreeWay(base, local, remote);
    expect(r.conflicts).toHaveLength(0);
    expect((r.merged as Record<string, unknown>).status).toBe("paid");
  });

  it("only the local side changed → local value (no conflict)", () => {
    const local = { ...base, note: "edited locally" };
    const r = computeThreeWay(base, local, { ...base });
    expect(r.conflicts).toHaveLength(0);
    expect((r.merged as Record<string, unknown>).note).toBe("edited locally");
  });

  it("only the remote side changed → remote value (recorded as auto-merged)", () => {
    const remote = { ...base, note: "edited remotely" };
    const r = computeThreeWay(base, { ...base }, remote);
    expect(r.conflicts).toHaveLength(0);
    expect((r.merged as Record<string, unknown>).note).toBe("edited remotely");
    expect(r.autoMergedPaths).toContain("note");
  });

  it("NO-SILENT-OVERWRITE guarantee: a both-sides divergence always conflicts", () => {
    // Never may the merge silently pick local or remote when both moved.
    const local = { ...base, amount: 1111 };
    const remote = { ...base, amount: 2222 };
    const r = computeThreeWay(base, local, remote);
    expect(r.conflicts.length).toBeGreaterThan(0);
    // The merged placeholder holds BASE — not a winner.
    expect((r.merged as Record<string, unknown>).amount).toBe(1000);
  });

  it("nothing changed → merged equals base, zero conflicts, zero auto-merges", () => {
    const r = computeThreeWay(base, { ...base }, { ...base });
    expect(r.conflicts).toHaveLength(0);
    expect(r.autoMergedPaths).toHaveLength(0);
    expect(r.merged).toEqual(base);
  });
});

describe("computeThreeWay — nesting and shapes", () => {
  it("nested objects recurse — the conflict lands on the LEAF path", () => {
    const b = { parent: { firstName: "Ahmed", contact: { phone: "+1" } }, id: "p1" };
    const l = { parent: { firstName: "Ahmed", contact: { phone: "+2" } }, id: "p1" };
    const r2 = { parent: { firstName: "Ahmed", contact: { phone: "+3" } }, id: "p1" };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe("parent.contact.phone");
  });

  it("disjoint NESTED changes auto-merge inside the subtree", () => {
    const b = { parent: { firstName: "A", lastName: "B" } };
    const l = { parent: { firstName: "A1", lastName: "B" } };
    const r2 = { parent: { firstName: "A", lastName: "B2" } };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged).toEqual({ parent: { firstName: "A1", lastName: "B2" } });
  });

  it("same-length arrays recurse index-wise — conflicting element lands on [i]", () => {
    const b = { installments: [{ id: "i1", applied: 0 }, { id: "i2", applied: 0 }] };
    const l = { installments: [{ id: "i1", applied: 100 }, { id: "i2", applied: 0 }] };
    const r2 = { installments: [{ id: "i1", applied: 200 }, { id: "i2", applied: 0 }] };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe("installments[0].applied");
  });

  it("array changed by ONE side only → applied wholesale (no conflict)", () => {
    const b = { tags: ["a"] };
    const l = { tags: ["a", "b", "c"] };
    const r = computeThreeWay(b, l, { tags: ["a"] });
    expect(r.conflicts).toHaveLength(0);
    expect((r.merged as Record<string, unknown>).tags).toEqual(["a", "b", "c"]);
  });

  it("arrays changed on both sides with DIFFERENT lengths → whole-array conflict", () => {
    const b = { tags: ["a"] };
    const l = { tags: ["a", "b"] };
    const r2 = { tags: ["a", "c", "d"] };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe("tags");
  });

  it("null transitions: null vs value on both sides conflicts (null is a real value)", () => {
    const b = { note: null };
    const l = { note: "local note" };
    const r2 = { note: null };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(0); // only local changed → applied
    expect((r.merged as Record<string, unknown>).note).toBe("local note");

    const b2 = { note: "base" };
    const l2 = { note: null };
    const r22 = { note: "remote" };
    const r2res = computeThreeWay(b2, l2, r22);
    expect(r2res.conflicts).toHaveLength(1);
    expect(r2res.conflicts[0].localValue).toBeNull();
    expect(r2res.conflicts[0].localDisplay).toBe("null");
  });

  it("a key added by BOTH sides with different values conflicts as added-vs-added", () => {
    const b = { id: 1 };
    const l = { id: 1, extra: "local" };
    const r2 = { id: 1, extra: "remote" };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe("extra");
  });

  it("a key DELETED remotely while edited locally conflicts as edit-vs-absent", () => {
    const b = { keep: 1, gone: "x" };
    const l = { keep: 1, gone: "edited" };
    const r2 = { keep: 1 };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe("gone");
  });

  it("shape mismatch (scalar vs object) on both sides conflicts at the path", () => {
    const b = { meta: 5 };
    const l = { meta: { deep: 1 } };
    const r2 = { meta: 6 };
    const r = computeThreeWay(b, l, r2);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe("meta");
  });
});

describe("resolveThreeWay — resolution semantics", () => {
  const b = { status: "pending", amount: 1000, note: "n", nested: { a: 1, b: 2 } };
  const conflictCase = () => {
    const l = { ...b, status: "paid", nested: { a: 99, b: 2 } };
    const r2 = { ...b, status: "cancelled", nested: { a: 1, b: 88 } };
    return computeThreeWay(b, l, r2);
  };

  it("take-local applies the local value at the conflict path", () => {
    const r = conflictCase();
    const resolved = resolveThreeWay(r, { status: { kind: "local" } }) as Record<string, unknown>;
    expect(resolved.status).toBe("paid");
  });

  it("take-remote applies the remote value at the conflict path", () => {
    const r = conflictCase();
    const resolved = resolveThreeWay(r, { status: { kind: "remote" } }) as Record<string, unknown>;
    expect(resolved.status).toBe("cancelled");
  });

  it("manual value applies the user's typed value", () => {
    const r = conflictCase();
    const resolved = resolveThreeWay(r, { status: { kind: "manual", value: "partiel" } }) as Record<string, unknown>;
    expect(resolved.status).toBe("partiel");
  });

  it("an OMITTED choice keeps the base placeholder (never a silent winner)", () => {
    const r = conflictCase();
    const resolved = resolveThreeWay(r, {}) as Record<string, unknown>;
    expect(resolved.status).toBe("pending");
  });

  it("nested conflict paths apply through setAtPath — disjoint subtree merges survive", () => {
    const r = conflictCase();
    // nested.a (base 1 → local 99, remote unchanged) and nested.b
    // (base 2 → remote 88, local unchanged) are BOTH single-side changes →
    // auto-merged, NOT conflicts. Only status (both sides moved) conflicts.
    expect(r.conflicts.map((c) => c.path)).toEqual(["status"]);
    expect([...r.autoMergedPaths].sort()).toEqual(["nested.a", "nested.b"]);
    const resolved = resolveThreeWay(r, {
      status: { kind: "remote" },
    }) as Record<string, unknown>;
    expect(resolved.status).toBe("cancelled");
    expect(resolved.nested).toEqual({ a: 99, b: 88 });
  });

  it("resolving an array-tail conflict with take-local restores the local array", () => {
    const b2 = { tags: ["a"] };
    const l = { tags: ["a", "b"] };
    const r2 = { tags: ["a", "c", "d"] };
    const r = computeThreeWay(b2, l, r2);
    const resolved = resolveThreeWay(r, { tags: { kind: "local" } }) as Record<string, unknown>;
    expect(resolved.tags).toEqual(["a", "b"]);
  });
});

describe("setAtPath — the path writer", () => {
  it("writes a dotted object path", () => {
    expect(setAtPath({ a: { b: 1 } }, "a.b", 2)).toEqual({ a: { b: 2 } });
  });

  it("writes through an array index segment", () => {
    expect(setAtPath({ items: [{ qty: 1 }] }, "items[0].qty", 5)).toEqual({ items: [{ qty: 5 }] });
  });

  it("creates missing intermediate containers", () => {
    expect(setAtPath({}, "x.y.z", 1)).toEqual({ x: { y: { z: 1 } } });
  });

  it("pads missing array slots with undefined (index-aligned writes)", () => {
    const out = setAtPath({ items: [] }, "items[2].qty", 9) as { items: unknown[] };
    expect(out.items).toHaveLength(3);
    expect(out.items[0]).toBeUndefined();
    expect(out.items[2]).toEqual({ qty: 9 });
  });

  it("the empty path replaces the root", () => {
    expect(setAtPath({ old: true }, "", { new: true })).toEqual({ new: true });
  });

  it("never mutates the input tree (pure)", () => {
    const input = { a: { b: 1 } };
    const out = setAtPath(input, "a.b", 2);
    expect(input).toEqual({ a: { b: 1 } });
    expect((out as Record<string, unknown>).a).toEqual({ b: 2 });
  });
});
