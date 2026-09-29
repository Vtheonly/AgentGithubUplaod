/**
 * T-439 — IDENT-103 regression suite: the ER-PMAE import bindings are
 * RUN-SCOPED and the matcher lifecycle is honest.
 *
 * THE BUGS (registered before the fix per §13):
 *
 *   1. CROSS-FILE BINDING LEAK — the commit-time matcher was built from
 *      EVERY approved/executed proposal in the repository (not scoped to
 *      the current run), and the observation ids were UNQUALIFIED
 *      (`import:row:${rowIndex}` — contradicting the documented
 *      source-qualified convention). An approval of row 42 in file A
 *      silently bound row 42 of file B — a different family — to file A's
 *      target with confidence 1 (an INV-50 violation: zero confirmation
 *      for file B). On Supabase the proposals persist across sessions and
 *      operators, so the leak crossed desktops too.
 *   2. STALE MATCHER ON FLAG-OFF — `getEngine` only ever ADDED a matcher
 *      (`entityMatcher && !engineHasMatcher`); once a commit ran with a
 *      matcher, turning the experimental flag OFF still routed the import
 *      through the stale `ConfirmedEntityMatcher` — "flag OFF ⇒ the
 *      byte-identical legacy path" (INV-40) was false within a modal's
 *      lifetime. (Pinned here by source-scan because `getEngine` is a
 *      component closure — the same class of pin the t-438 suite uses,
 *      extended to the lifecycle semantics that scan missed.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildCurrentRunBindings,
  erImportRowObservationId,
} from "../../infrastructure/excel/import-engine/er-matcher";
import type { ErMatchProposal } from "../../domain/identity/types";

const RUN_A = "run-fileA-2027-2026";
const RUN_B = "run-fileB-2028-2029";

function proposal(overrides: Partial<ErMatchProposal>): ErMatchProposal {
  return {
    id: overrides.id ?? "prop-1",
    runId: overrides.runId ?? RUN_A,
    createdAt: "2026-01-01T00:00:00.000Z",
    aObservationId: overrides.aObservationId ?? "xlsx:fileA.xlsx:row-42",
    bObservationId: overrides.bObservationId ?? "canonical:par-target",
    score: overrides.score ?? ({ total: 0.95 } as ErMatchProposal["score"]),
    status: overrides.status ?? "approved",
    decidedBy: null,
    decidedAt: null,
    rationale: null,
    ...overrides,
  };
}

describe("T-439 / IDENT-103 — buildCurrentRunBindings (the run-scoped commit bindings)", () => {
  const fileARowIds = [
    erImportRowObservationId(42, "xlsx:fileA.xlsx"),
    erImportRowObservationId(7, "xlsx:fileA.xlsx"),
  ];

  it("binds the CURRENT run's approved proposals for the current file's rows (the happy path)", () => {
    const bindings = buildCurrentRunBindings(
      [proposal({ aObservationId: erImportRowObservationId(42, "xlsx:fileA.xlsx") })],
      RUN_A,
      fileARowIds,
    );
    expect(bindings.size).toBe(1);
    expect(bindings.get(erImportRowObservationId(42, "xlsx:fileA.xlsx"))).toBe("par-target");
  });

  it("THE CROSS-RUN LEAK: another run's approval (file B's) NEVER binds this file's rows", () => {
    // File A's row 42 observation id has the SAME rowIndex as file B's —
    // but the ids are source-qualified now, AND the run filter drops the
    // foreign proposal even if the ids somehow collided.
    const bindings = buildCurrentRunBindings(
      [proposal({ runId: RUN_B, aObservationId: erImportRowObservationId(42, "xlsx:fileB.xlsx") })],
      RUN_A,
      fileARowIds,
    );
    expect(bindings.size).toBe(0);
  });

  it("THE CROSS-FILE LEAK (same run id, foreign row id): a proposal whose aObservationId is NOT one of the current file's rows never binds", () => {
    const bindings = buildCurrentRunBindings(
      [proposal({ aObservationId: erImportRowObservationId(42, "xlsx:fileB.xlsx") })],
      RUN_A,
      fileARowIds,
    );
    expect(bindings.size).toBe(0);
  });

  it("a rejected or still-proposed CURRENT-run proposal never binds", () => {
    for (const status of ["rejected", "proposed"] as const) {
      const bindings = buildCurrentRunBindings(
        [proposal({ status })],
        RUN_A,
        fileARowIds,
      );
      expect(bindings.size).toBe(0);
    }
  });

  it("NO analysis for this file (runId null) ⇒ NOTHING may bind (the honest degradation)", () => {
    const bindings = buildCurrentRunBindings(
      [proposal({ aObservationId: erImportRowObservationId(42, "xlsx:fileA.xlsx") })],
      null,
      fileARowIds,
    );
    expect(bindings.size).toBe(0);
  });

  it("a non-canonical target (a row-to-row proposal, no canonical:) is skipped", () => {
    const bindings = buildCurrentRunBindings(
      [proposal({ bObservationId: "xlsx:other.xlsx:row-9" })],
      RUN_A,
      fileARowIds,
    );
    expect(bindings.size).toBe(0);
  });
});

describe("T-439 / IDENT-103 — the source-qualified observation ids", () => {
  it("two files' row 42 observations have DIFFERENT ids (the collision the leak rode on)", () => {
    const a = erImportRowObservationId(42, "xlsx:fileA.xlsx");
    const b = erImportRowObservationId(42, "xlsx:fileB.xlsx");
    expect(a).toBe("xlsx:fileA.xlsx:row-42");
    expect(b).toBe("xlsx:fileB.xlsx:row-42");
    expect(a).not.toBe(b);
  });

  it("the LEGACY unqualified shape survives for pre-T-439 callers (the t-438 pins)", () => {
    expect(erImportRowObservationId(42)).toBe("import:row:42");
  });
});

describe("T-439 / IDENT-103 — the matcher lifecycle (the stale-matcher pin)", () => {
  const modalSource = readFileSync(
    path.resolve(process.cwd(), "src/features/crm/excel-import-modal.tsx"),
    "utf8",
  );

  it("getEngine rebuilds on matcher IDENTITY change — the additive-only condition is gone", () => {
    // The lifecycle fix: the engine is rebuilt whenever the matcher
    // INSTANCE differs from the one it was built with (add OR remove).
    expect(modalSource).toContain("engineMatcherRef.current !== entityMatcher");
    expect(modalSource).toContain("engineMatcherRef.current = entityMatcher");
    // The old additive-only CONDITION must be GONE from the code (it could
    // never remove) — pinned on the full if-statement so the explanatory
    // comment documenting the history does not satisfy the scan.
    expect(modalSource).not.toContain("if (!engineRef.current || (entityMatcher && !engineHasMatcher)) {");
  });

  it("the commit-time bindings go through the run-scoped builder (never the raw repository filter)", () => {
    expect(modalSource).toContain("buildCurrentRunBindings(");
    // The old unscoped repository filter must be GONE.
    expect(modalSource).not.toMatch(
      /\.filter\(\s*\(p\) => p\.status === "approved" \|\| p\.status === "executed"\s*,?\s*\)/,
    );
  });

  it("the adapter seam carries the workbook identity (entityMatchSourceSystem)", () => {
    expect(modalSource).toContain("entityMatchSourceSystem: fileName ? `xlsx:${fileName}` : undefined");
  });
});
