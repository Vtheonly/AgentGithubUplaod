/**
 * E2.6 / BUG-013 — the node-inspector's role vocabulary.
 *
 * WHAT THIS SUITE PINS (the Session-45 fix):
 *
 *   The drawer's RoleSelect offered NON-CANONICAL role strings
 *   (superadmin / supervisor / finance_officer) while every other RBAC
 *   surface speaks the Role enum (super_admin / manager /
 *   financial_officer — roles.ts). The Select now offers ONLY canonical
 *   values, and a read-side normalizer maps the legacy spellings still
 *   emitted by the seeded templates (templates.ts: "finance_officer",
 *   "supervisor") so an existing node never renders a blank select.
 *
 *   Source-guard style (the t-219/t-345 pattern): the drawer is a deep
 *   composite whose full render harness is disproportionate to the
 *   defect; the pinned surface is the vocabulary contract itself,
 *   cross-checked against the Role enum so the two files can never
 *   drift apart again.
 *
 * Run:
 *   npx vitest run src/tests/features/t-e26-bug013-role-strings.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Role } from "../../core/rbac/roles";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..", "src");

function src(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf-8");
}

const drawer = src("features/workflow/node-inspector-drawer.tsx");
const roleEnumValues = Object.values(Role) as string[];

describe("E2.6 / BUG-013 — the node-inspector RoleSelect speaks the canonical Role enum", () => {
  it("every SelectItem value in RoleSelect is a canonical Role enum value", () => {
    const selectBlock = drawer.slice(
      drawer.indexOf("function RoleSelect"),
      drawer.indexOf("function RoleSelect") + 900,
    );
    const offered = [...selectBlock.matchAll(/<SelectItem value="([^"]+)">/g)].map(
      (m) => m[1],
    );
    expect(offered.length).toBeGreaterThanOrEqual(5);
    for (const value of offered) {
      // The cross-file pin: the offered value EXISTS in the enum.
      expect(roleEnumValues, `SelectItem "${value}" must be a Role enum value`).toContain(value);
    }
  });

  it("the legacy spellings are gone from the Select options", () => {
    const selectBlock = drawer.slice(
      drawer.indexOf("function RoleSelect"),
      drawer.indexOf("function RoleSelect") + 900,
    );
    expect(selectBlock).not.toContain('value="superadmin"');
    expect(selectBlock).not.toContain('value="supervisor"');
    expect(selectBlock).not.toContain('value="finance_officer"');
  });

  it("the legacy spellings normalize on read (saved nodes from the old vocabulary)", () => {
    const normalizer = drawer.slice(
      drawer.indexOf("function normalizeAssigneeRoleValue"),
      drawer.indexOf("function RoleSelect"),
    );
    expect(normalizer).toContain('case "superadmin":');
    expect(normalizer).toContain('return "super_admin";');
    expect(normalizer).toContain('case "supervisor":');
    expect(normalizer).toContain('return "manager";');
    expect(normalizer).toContain('case "finance_officer":');
    expect(normalizer).toContain('return "financial_officer";');
  });

  it("the execution side tolerates BOTH vocabularies (mapAssigneeRole's alias map — no stranded nodes)", () => {
    const effects = src("infrastructure/mock/repositories/workflow-side-effects.ts");
    // The canonical spellings the Select now writes:
    expect(effects).toContain('case "financial_officer":');
    expect(effects).toContain('case "super_admin":');
    expect(effects).toContain('case "manager":');
    // The legacy spellings the seeded templates still emit:
    expect(effects).toContain('case "finance_officer":');
    expect(effects).toContain('case "supervisor":');
  });
});
