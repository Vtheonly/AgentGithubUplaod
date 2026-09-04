/**
 * T-104 / ADR-010 — display-level parent-credit derivation (DATA-009).
 *
 * The canonical writer `collect_and_allocate_payment` books the FULL payment
 * entry AND a `parent_credit` adjustment on overpayment, so the raw ledger
 * balance (totalOutstanding, INV-1) double-counts the credit for
 * canonical-path overpayments. ADR-010 chose option (b): keep the writer
 * (the equivalence suites pin its shape) and standardize a display-level
 * derivation:
 *
 *   credit = balance < 0 ? (unallocatedCredit < 0 ? -unallocatedCredit
 *                                                 : -balance)
 *                        : 0
 *
 * covering BOTH live populations:
 *  - canonical overpayments (credit entries booked → |unallocated| is true),
 *  - historical overpayers from the 0062 reconciliation (deliberately NO
 *    parent_credit entries → the raw negative balance is exact).
 *
 * The website port (src/lib/canonical/portal-derive.ts in elimtiyaz-website)
 * implements the identical rule and is pinned there (t-104 tests).
 */
import { describe, expect, it } from "vitest";
import { displayParentCredit } from "../../../domain/calc/ledger/balance";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("displayParentCredit — ADR-010 display derivation (T-104)", () => {
  it("DATA-009 canonical overpayment: 100k charge, −150k payment, −50k credit → 50k (NOT the double-counted 100k)", () => {
    expect(displayParentCredit(-100_000, -50_000)).toBe(50_000);
  });

  it("historical overpayer (0062 reconciliation, no credit entries): −50k balance → 50k", () => {
    expect(displayParentCredit(-50_000, 0)).toBe(50_000);
  });

  it("normal debtor: positive balance → 0 regardless of unallocated credit", () => {
    expect(displayParentCredit(30_000, 0)).toBe(0);
    // Goodwill credit fully absorbed by later charges (balance net positive).
    expect(displayParentCredit(50_000, -50_000)).toBe(0);
  });

  it("standalone goodwill credit (no charge yet): −50k balance, −50k credit → 50k", () => {
    expect(displayParentCredit(-50_000, -50_000)).toBe(50_000);
  });

  it("mixed: credit partly absorbed by a new charge (balance −20k, unallocated 0) → 20k", () => {
    expect(displayParentCredit(-20_000, 0)).toBe(20_000);
  });

  it("zero balances → 0", () => {
    expect(displayParentCredit(0, 0)).toBe(0);
    expect(displayParentCredit(0, -1_000)).toBe(0);
  });

  it("desktop dossier card uses the derivation (source-scan guard)", () => {
    const drawer = readFileSync(
      join(__dirname, "../../../features/crm/parent-detail-drawer.tsx"),
      "utf8",
    );
    expect(drawer).toContain("displayParentCredit(outstanding, profile?.totalUnallocatedCredit ?? 0)");
    // The old raw-negation derivation must be gone from the card.
    expect(drawer).not.toMatch(/value=\{-outstanding\}/);
  });

  it("profile builders feed totalUnallocatedCredit into ParentFinancialProfile", () => {
    const supabase = readFileSync(
      join(__dirname, "../../../infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
      "utf8",
    );
    const mock = readFileSync(
      join(__dirname, "../../../infrastructure/mock/repositories/financial/debt-ops.ts"),
      "utf8",
    );
    for (const src of [supabase, mock]) {
      expect(src).toContain("totalUnallocatedCredit: summary.totalUnallocatedCredit");
    }
  });

  // T-157 — ADR-010's implementation-map noted the debt-meter's
  // `unallocatedCredit` prop was dormant (never passed) at the unified
  // payment modal. The wiring landed with the ADR-010 derivation — this
  // guard pins it so a future edit cannot silently revert to a raw
  // balance/unallocated value.
  it("unified payment modal wires the debt meter through the ADR-010 derivation (source-scan guard)", () => {
    const modal = readFileSync(
      join(__dirname, "../../../features/financials/unified-payment-modal.tsx"),
      "utf8",
    );
    expect(modal).toContain('import { displayParentCredit } from "../../domain/calc/ledger/balance"');
    expect(modal).toContain("unallocatedCredit={bankedCredit}");
    expect(modal).toContain("debtProfile?.totalOutstanding ?? 0");
    expect(modal).toContain("debtProfile?.totalUnallocatedCredit ?? 0");
    // The dormant-era default (prop absent) must not come back: the meter
    // call site must carry the derived prop explicitly.
    expect(modal).toMatch(/<DebtMeter\s[\s\S]*?unallocatedCredit=\{bankedCredit\}/);
  });

  it("debt-meter documents the ADR-010 magnitude contract (source-scan guard)", () => {
    const meter = readFileSync(
      join(__dirname, "../../../features/financials/debt-meter.tsx"),
      "utf8",
    );
    expect(meter).toContain("ADR-010 display derivation");
    expect(meter).toContain("MAGNITUDE (always >= 0; 0 hides the row)");
  });
});
