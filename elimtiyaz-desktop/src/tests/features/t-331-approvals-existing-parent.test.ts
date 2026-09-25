/**
 * T-331 — the account-approval → assign-to-EXISTING-parent workflow,
 * properly registered (58th session, 2026-09-13).
 *
 * Owner mandate: "When someone creates an account on the website and that
 * account is not yet confirmed or linked to a parent, and I approve the
 * account from the desktop application, I do not want the system to create
 * a completely new parent record. Instead, the approval process should
 * allow the administrator to assign the existing registered account to one
 * of the existing parents in the system… It should not create a duplicate
 * parent, duplicate children, duplicate enrollments, or duplicate financial
 * records."
 *
 * The backend already owns the semantics (approve-signup-request EF +
 * approve_account_request RPC with p_target_parent_id, rebind guard 0047,
 * PARENT-102 missing-target guard). The owner's unregistered 670bc82 "idk"
 * patch added the right DESKTOP UI idea (a searchable parent picker in the
 * DecisionModal) but shipped without tests/registration and without
 * binding-status awareness — an admin could select an ALREADY-BOUND parent
 * and only learn of the 0047 rejection AFTER submit.
 *
 * This suite pins the properly-refactored desktop half:
 *   1. The Parent domain model carries authUserId (mapParentRow populates
 *      it from parents.auth_user_id) — the binding-status input.
 *   2. The DecisionModal picker disables + flags already-bound parents
 *      BEFORE selection, and a bound selection blocks the submit.
 *   3. The search covers name / code / phone / email.
 *   4. The repository layer sends target_parent_id to the EF (existing
 *      contract preserved — no parallel implementation).
 *   5. "Approuver & Lier" works even without an auto-detected parent_match
 *      (the admin's manual choice IS the assignment path).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../.."); // src/
const APP_ROOT = join(SRC, ".."); // elimtiyaz-desktop/
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

const TAB = read("features/settings/approvals-tab.tsx");
const REPO = read("infrastructure/supabase/repositories/supabase-approval-repository.ts");
const PARENT_MODEL = read("domain/model/parent.ts");
const SHARED_REPOS = read(
  "infrastructure/supabase/repositories/supabase-shared-repositories.ts",
);
// The EF lives OUTSIDE src/ — under the app root's supabase/functions/.
const EF = readFileSync(
  join(APP_ROOT, "supabase/functions/approve-signup-request/index.ts"),
  "utf8",
);

describe("T-331 — the binding-status input (Parent.authUserId)", () => {
  it("the domain model declares the optional field", () => {
    expect(PARENT_MODEL).toContain("readonly authUserId?: string | null;");
  });

  it("mapParentRow populates it from parents.auth_user_id", () => {
    expect(SHARED_REPOS).toContain("authUserId: r.auth_user_id ?? null,");
  });
});

describe("T-331 — the picker pre-empts the 0047 rebind guard", () => {
  it("bound parents are disabled + flagged in the results list", () => {
    expect(TAB).toMatch(/const bound = !!p\.authUserId/);
    expect(TAB).toContain("disabled={bound}");
    expect(TAB).toContain("Compte lié");
  });

  it("a selected-but-bound parent blocks the confirmation", () => {
    expect(TAB).toContain("const selectedParentBound =");
    // T-413: the submit gate now spans the parent picker AND the student
    // branches — the parent leg keeps the same T-331 semantics inside the
    // multi-branch expression.
    expect(TAB).toMatch(
      /isApproveExisting && \(selectedParentBound \|\| !decision\.targetParentId\)/,
    );
    expect(TAB).toMatch(/studentNewInvalid/);
  });

  it("the warning cites the unbind path (RBAC editor, 0047)", () => {
    expect(TAB).toContain("éditeur RBAC");
    expect(TAB).toMatch(/migration 0047/);
  });
});

describe("T-331 — the manual assignment path (no auto-match required)", () => {
  it("handleApproveExisting opens the picker without requiring parent_match", () => {
    // The owner's scenario: a fresh signup with NO auto-detected match must
    // still be assignable to an existing parent by manual search.
    expect(TAB).toMatch(/targetParentId: request\.parent_match\?\.id \?\? null/);
    expect(TAB).not.toContain(
      'showError("Aucun parent correspondant. Utilisez',
    );
  });

  it("submitting without a selection is blocked client-side too", () => {
    expect(TAB).toContain(
      'if (!decisionModal.targetParentId) {',
    );
  });

  it("the search covers name, code, phone AND email", () => {
    expect(TAB).toMatch(/\(p\.email \?\? ""\)\.toLowerCase\(\)\.includes\(q\)/);
  });
});

describe("T-331 — the repository + EF contract is preserved (no parallel path)", () => {
  it("approveWithExistingParent sends target_parent_id to the canonical EF", () => {
    expect(REPO).toContain("approveWithExistingParent");
    expect(REPO).toContain("target_parent_id: targetParentId");
    expect(REPO).toContain('"approve-signup-request"');
  });

  it("the EF guards PARENT-102 (no unbound approvals) and passes the target down", () => {
    expect(EF).toContain("missing_target_parent");
    expect(EF).toContain("p_target_parent_id: targetParentId ?? null");
    expect(EF).toContain('rpc("approve_account_request"');
  });
});
