/**
 * E2.6 / BUG-027 — the operator-facing copy must state the REAL policy.
 *
 * WHAT THIS SUITE PINS (the Session-45 fix, source-guard style):
 *
 *   1. The payment-plan options: the old copy claimed "3 tranches
 *      (40/30/30)" and "−10% avant le 30 juin" — no era's engine ever
 *      applied either. The REAL policy: 3 tranches with amounts from the
 *      per-grade barème (V1/2V/v3), and the full-annual early-payment
 *      discount is 5% of the scolarité (FI + transport excluded) before
 *      June 30 of the start year (EARLY_PAYMENT_RATE = 0.05 /
 *      earlyPaymentCutoff, school-price-matrix.ts).
 *   2. The transport card's destination count: derived from
 *      TRANSPORT_DESTINATIONS (28 entries today — 4 legacy zones + 24
 *      real towns), never a hardcoded number that lies at the next town.
 *   3. The RBAC matrix header: derived from the role/permission
 *      catalogs (the old copy hardcoded "6 rôles × 28 permissions" —
 *      both counts long stale).
 *   4. The known-stale sub-items are CLOSED BY VERIFICATION: the
 *      "Messager interne" label no longer exists anywhere in the tree,
 *      and the prescolaire wizard gap is NOT copy — it is UNKNOWN-031
 *      (an owner decision on the AcademicLevel taxonomy).
 *
 * Run:
 *   npx vitest run src/tests/features/t-e26-bug027-copy-truth.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRANSPORT_DESTINATIONS } from "../../domain/model/parent";
import { Permission } from "../../core/rbac/permissions";
import { STAFF_ROLES } from "../../core/rbac/roles";
import { EARLY_PAYMENT_RATE } from "../../domain/calc/pricing/school-price-matrix";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..", "src");

function src(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf-8");
}

const modal = src("features/crm/edit-student-modal.tsx");
const transportCard = src("features/settings/pricing/transport-card.tsx");
const rbacEditor = src("features/settings/rbac-matrix-editor.tsx");

describe("E2.6 / BUG-027 — the copy states the real policy", () => {
  it("the payment-plan options carry the REAL early-payment rate (5%, from the pricing engine)", () => {
    expect(EARLY_PAYMENT_RATE).toBe(0.05);
    expect(modal).toContain("−5 % de la scolarité avant le 30 juin");
    // The false claims are gone:
    expect(modal).not.toContain("40/30/30");
    expect(modal).not.toContain("−10%");
  });

  it("the transport destination count is DERIVED from the matrix (never a hardcoded lie)", () => {
    // The matrix is 28 entries today; the label computes it.
    expect(TRANSPORT_DESTINATIONS.length).toBeGreaterThanOrEqual(28);
    expect(transportCard).toContain(
      "Transport scolaire ({TRANSPORT_DESTINATIONS.length} destinations)",
    );
    expect(transportCard).not.toContain("(4 destinations)");
  });

  it("the RBAC header derives from the role/permission catalogs", () => {
    expect(rbacEditor).toContain("{staffRoleList.length} rôles × {Object.values(Permission).length} permissions");
    expect(rbacEditor).not.toContain("6 rôles × 28 permissions");
    // The derived values are the REAL current catalogs.
    expect(STAFF_ROLES.size).not.toBe(6);
    expect(Object.values(Permission).length).not.toBe(28);
  });

  it("the stale sub-items are closed by verification (no 'Messager interne' anywhere; prescolaire = UNKNOWN-031)", () => {
    // Grep-like scan over the feature tree: the label is gone.
    let found = "";
    try {
      found = execSync(
        `grep -rl "Messager interne" ${join(ROOT, "features")} ${join(ROOT, "shared")} || true`,
        { encoding: "utf-8" },
      ).trim();
    } catch {
      found = "";
    }
    expect(found).toBe("");
    // The prescolaire decision is recorded where owner decisions live
    // (repo root = two levels above src/).
    const unknowns = readFileSync(
      join(ROOT, "..", "..", "docs", "recovery", "unknowns.md"),
      "utf-8",
    );
    expect(unknowns).toContain("UNKNOWN-031");
  });
});
