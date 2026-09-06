/**
 * T-219 / T-220 — source-scan guards for the wide-form payment modal and
 * the payments-journal issuer columns (same pattern as the t-205 desktop
 * grid-blowout guard: pin the shipped source, so a regression — a size
 * downgrade, a dropped two-column grid, a removed height cap — fails the
 * suite instead of silently reintroducing the owner-reported cut-off).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..", "src");

function src(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf-8");
}

describe("T-219 — 16:9 wide payment modal (source guard)", () => {
  const modal = src("features/financials/unified-payment-modal.tsx");
  const types = src("shared/ui/unified-modal/types.ts");
  const shell = src("shared/ui/unified-modal/modal-shell.tsx");

  it("the modal uses the 2xl wide-form tier (~1152px stage)", () => {
    expect(modal).toContain('size="2xl"');
  });

  it("the 2xl tier is registered as max-w-6xl in the design system", () => {
    expect(types).toContain('"2xl": "max-w-6xl"');
  });

  it("the dialog shell caps height at 88vh (footer can never be pushed off-screen)", () => {
    expect(shell).toContain("max-h-[88vh]");
    expect(shell).toContain("flex max-h-[88vh] w-full -translate-x-1/2 -translate-y-1/2 flex-col");
    // The old grid-based dialog layout made the body's flex-1 inert.
    expect(shell).not.toContain("grid w-full -translate-x-1/2 -translate-y-1/2 flex-col");
  });

  it("the form body is a responsive 12-col two-column split (7+5)", () => {
    expect(modal).toContain("lg:grid-cols-12");
    expect(modal).toContain("lg:col-span-7");
    expect(modal).toContain("lg:col-span-5");
  });

  it("the form footer keeps the payer/amount recap + actions (always visible)", () => {
    expect(modal).toContain("Encaisser");
    expect(modal).toContain("Annuler");
    expect(modal).toContain("à régler");
  });

  it("the old single-column size=lg stage is gone", () => {
    expect(modal).not.toMatch(/size="lg"/);
  });
});

describe("T-220 — payments journal issuer + exact timestamp (source guard)", () => {
  const page = src("features/financials/financials-page.tsx");

  it("the Émetteur (Payeur) column exists with the parent identity", () => {
    expect(page).toContain("Émetteur (Payeur)");
    expect(page).toContain("parentDisplayName");
    expect(page).toContain("parentCode");
  });

  it("the exact Date & Heure column uses formatDateTime (not only relative)", () => {
    expect(page).toContain("Date & Heure");
    expect(page).toContain("formatDateTime");
    expect(page).toContain("formatRelative");
  });

  it("the collector attribution (Encaissé par) is surfaced", () => {
    expect(page).toContain("Reçu / Encaissé par");
    expect(page).toContain("Par :");
  });

  it("search spans the issuer fields", () => {
    expect(page).toContain('"parentName"');
    expect(page).toContain('"studentName"');
    expect(page).toContain('"parentCode"');
  });

  it("the enriched rows resolve parents + students from the repositories", () => {
    expect(page).toContain("repos.parents.observe()");
    expect(page).toContain("repos.students.observe()");
  });
});

describe("T-221 — DAG builder shipped (source guard)", () => {
  it("the canvas carries the dry-run + zoom/pan/minimap/auto-layout features", () => {
    const canvas = src("features/workflow/dag-canvas.tsx");
    expect(canvas).toContain("dryRunWorkflow");
    expect(canvas).toContain("autoLayout");
    expect(canvas).toContain("handleMinimapJump");
    expect(canvas).toContain("onInspectNode");
    expect(canvas).toContain('title="Réorganiser selon la topologie"');
  });

  it("the node inspector drawer exists with the predicate builder", () => {
    const inspector = src("features/workflow/node-inspector-drawer.tsx");
    expect(inspector).toContain("PredicateRowEditor");
    expect(inspector).toContain("treeFromRows");
    expect(inspector).toContain("defaultConditionContext");
    expect(inspector).toContain("route_switch");
  });

  it("the template picker is wired into the new-workflow modal", () => {
    const wfPage = src("features/workflow/workflow-page.tsx");
    expect(wfPage).toContain("WORKFLOW_TEMPLATES");
    expect(wfPage).toContain("instantiateTemplate");
    expect(wfPage).toContain("NodeInspectorDrawer");
  });

  it("the mock executor walks the graph through the dry-run engine", () => {
    const repo = src("infrastructure/mock/repositories/workflow-repository.ts");
    expect(repo).toContain("dryRunWorkflow");
  });
});
