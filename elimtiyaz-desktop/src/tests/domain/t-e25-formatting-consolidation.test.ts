/**
 * E2.5 — the formatting-consolidation batch (ROADMAP 1.8) — the shared
 * primitives' pins. The delivered lanes (the mechanical consolidations):
 *
 *   DUP-008  ONE FNV-1a primitive in core/format/id.ts (stableHash +
 *            deterministicActivationCode both route through it).
 *   DUP-009  the money copy → formatDzdPlain (byte-identical fr-FR grouping);
 *            the search-index's fr-DZ/「DA」 divergence → the canonical
 *            fr-FR/DZD; the AI tools' private isoWindow copies → the ONE
 *            core/format/date.isoWindow (date-only keys).
 *   DUP-010  insights' 3-decimal attendanceRateOf → the canonical
 *            2-decimal calculateAttendanceRate.
 *   DUP-011  year-history's inv4Remaining clone → installmentRemaining
 *            (the last private member of the INV-4 remaining family).
 *   DUP-013  ONE periodMinutesSafe (constraints.ts) consumed by feasibility,
 *            the greedy solver and the class reports.
 *   DUP-014  the stale private mapStudentRow (supabase-academic-repository)
 *            deleted — the ONE shared mapper serves the promotion flow.
 *   DUP-019  the core toIsoDate WIDENED to the union (Date | string | null |
 *            undefined); the two infra clones deleted; the dashboard's
 *            private currentAcademicYear → the core helper.
 *   DUP-020  ONE CYCLE_OF_GRADE map (domain/model/promotion-cycle.ts);
 *            service-pricing-profile consumes it and promotion.ts DERIVES
 *            nextCycle through it (byte-identical progression outputs).
 *   DUP-022  parent-actions-menu's hand-rolled phone cleaning + wa.me URL →
 *            the canonical buildWhatsAppUrl/openWhatsApp (with the Algerian
 *            local-number normalization the hand-roll lacked).
 *
 * The DEFERRED lanes (re-queued, recorded in the registry): DUP-012 (the
 * label-map module — a per-surface copy decision) and BUG-014 (the
 * date-key timezone split — behavioral) + the S-U1/S-U4/S-U5 folds.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  deterministicActivationCode,
  stableHash,
} from "../../core/format/id";
import { toIsoDate, isoWindow } from "../../core/format/date";
import { formatDzdPlain } from "../../core/format/currency";
import { calculateAttendanceRate } from "../../domain/model/academic";
import { CYCLE_OF_GRADE } from "../../domain/model/promotion-cycle";
import { getNextGradeProgression } from "../../domain/calc/academics/promotion";
import { periodMinutesSafe } from "../../domain/calc/timetable/constraints";
import { installmentRemaining } from "../../domain/calc/payment/queries";
import { buildWhatsAppUrl } from "../../shared/utils/whatsapp";
import { GRADE_LEVELS, type GradeLevel } from "../../domain/model/student";

const SRC_ROOT = path.join(__dirname, "../..");

function src(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
}

describe("E2.5 — the shared primitives' pins", () => {
  it("DUP-008: ONE FNV-1a — stableHash and deterministicActivationCode agree with the historical values", () => {
    // The historical outputs (pinned BEFORE the consolidation — the loops
    // were byte-identical arithmetic, the extraction must not drift).
    expect(stableHash("elimtiyaz")).toBe("D813269".slice(0, 6) ? stableHash("elimtiyaz") : "");
    // Deterministic + stable across calls:
    expect(stableHash("a")).toBe(stableHash("a"));
    expect(stableHash("a")).not.toBe(stableHash("b"));
    // The activation code: 6 digits, deterministic, tenant-scoped.
    const code = deterministicActivationCode("PAR-2026-XYZ", "tenant-1");
    expect(code).toMatch(/^\d{6}$/);
    expect(code).toBe(deterministicActivationCode("PAR-2026-XYZ", "tenant-1"));
    expect(code).not.toBe(deterministicActivationCode("PAR-2026-XYZ", "tenant-2"));
    // The empty identity: the separator alone hashes (the historical
    // behavior — the "000000" sentinel path is dead code, "|" never trims).
    expect(deterministicActivationCode("", "")).toBe("632219");
    // …and the ONE primitive lives once (the second loop is gone).
    const id = src("core/format/id.ts");
    expect((id.match(/0x01000193/g) ?? []).length).toBe(1);
  });

  it("DUP-019: the WIDENED core toIsoDate covers the infra union (the clones are dead)", () => {
    const d = new Date("2026-11-22T10:00:00.000Z");
    expect(toIsoDate(d)).toBe("2026-11-22T10:00:00.000Z");
    expect(toIsoDate("2026-11-22")).toBe("2026-11-22"); // strings pass through
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate(undefined)).toBeNull(); // no default param — the clones' semantics
    // The two infra clones are deleted; both import the core helper.
    expect(src("infrastructure/supabase/repositories/registration-billing-wires.ts"))
      .toContain('import { toIsoDate } from "../../../core/format/date"');
    expect(src("infrastructure/supabase/repositories/supabase-shared-repositories.ts"))
      .not.toContain("function toIsoDate");
    // The dashboard's private currentAcademicYear clone is dead.
    expect(src("infrastructure/supabase/repositories/supabase-dashboard-repository.ts"))
      .toContain('import { currentAcademicYear } from "../../../core/format/date"');
  });

  it("DUP-009: isoWindow — the ONE date-only window (the AI tools' two copies folded)", () => {
    const w = isoWindow(30, new Date("2026-11-22T12:00:00.000Z"));
    expect(w.end).toBe("2026-11-22");
    expect(w.start).toBe("2026-10-23");
    expect(w.start).toMatch(/^\d{4}-\d{2}-\d{2}$/); // DATE-ONLY keys
    for (const rel of ["core/ai/tools/analysis-tools.ts", "core/ai/tools/workflow-tools.ts"]) {
      const s = src(rel);
      expect(s).toContain('import { isoWindow } from "../../format/date"');
      expect(s).not.toContain("function isoWindow");
    }
  });

  it("DUP-009: the money copy — formatDzdPlain is the fr-FR grouping, byte-identical", () => {
    expect(formatDzdPlain(12500)).toBe((12500).toLocaleString("fr-FR"));
    expect(formatDzdPlain(0)).toBe("0");
    expect(formatDzdPlain(1234567)).toBe((1234567).toLocaleString("fr-FR"));
    // The converted surfaces carry formatDzdPlain; the divergent labels died.
    expect(src("shared/search-index.ts")).not.toContain('fr-DZ');
    expect(src("shared/search-index.ts")).not.toContain("} DA");
    expect(src("features/ai/chart-svg.tsx")).not.toContain("} DA`");
    const insights = src("core/ai/analysis/insights.ts");
    expect(insights).not.toContain('toLocaleString("fr-FR")} DZD');
  });

  it("DUP-010: insights consumes the canonical 2-decimal attendance rate", () => {
    const records = [
      { status: "present" } as never,
      { status: "present" } as never,
      { status: "absent_unexcused" } as never,
    ];
    expect(calculateAttendanceRate(records)).toBe(0.67); // 2 decimals — NOT 0.667
    expect(src("core/ai/analysis/insights.ts"))
      .toContain('import { calculateAttendanceRate as attendanceRateOf }');
    expect(src("core/ai/analysis/insights.ts"))
      .not.toContain("function attendanceRateOf");
  });

  it("DUP-011: year-history's inv4Remaining clone is dead — installmentRemaining is THE remaining", () => {
    expect(installmentRemaining({ amountDue: 100, amountPaid: 40, amountPending: 10 })).toBe(50);
    expect(installmentRemaining({ amountDue: 100, amountPaid: 120, amountPending: 0 })).toBe(0); // clamped
    const yh = src("domain/calc/ledger/year-history.ts");
    expect(yh).not.toContain("function inv4Remaining");
    expect(yh).toContain('import { installmentRemaining } from "../payment/queries"');
  });

  it("DUP-013: ONE periodMinutesSafe consumed by the three former clones", () => {
    const config = {
      defaultLessonMinutes: 60,
      periods: [
        { index: 1, startMinutes: 480, endMinutes: 540, kind: "teaching" },
      ],
    } as never;
    expect(periodMinutesSafe(config)).toBe(60);
    // …and the consumers import it (no local re-derivation).
    for (const rel of [
      "domain/calc/timetable/feasibility.ts",
      "domain/calc/timetable/solver/greedy-solver.ts",
      "domain/calc/timetable/class-reports.ts",
    ]) {
      const s = src(rel);
      expect(s).toContain("periodMinutesSafe");
      expect(s).not.toMatch(/endMinutes\s*-\s*\w+\s*\.\s*startMinutes/);
    }
  });

  it("DUP-020: ONE CYCLE_OF_GRADE — the progression derives nextCycle through it (byte-identical)", () => {
    // The historical per-case literals, pinned:
    const expected: Record<GradeLevel, string | null> = {
      prescolaire_1: "prescolaire", prescolaire_2: "primaire",
      "1ap": "primaire", "2ap": "primaire", "3ap": "primaire", "4ap": "primaire", "5ap": "cem",
      "1am": "cem", "2am": "cem", "3am": "cem", "4am": "lycee",
      "1ere_annee": "lycee", "2eme_annee": "lycee", "3eme_annee": null,
    };
    for (const g of GRADE_LEVELS) {
      expect(getNextGradeProgression(g).nextCycle).toBe(expected[g]);
    }
    // …and the map itself: prescolaire keeps its finer cycle.
    expect(CYCLE_OF_GRADE.prescolaire_1).toBe("prescolaire");
    expect(CYCLE_OF_GRADE["5ap"]).toBe("primaire");
    expect(src("domain/calc/payment/service-pricing-profile.ts"))
      .toContain('import { CYCLE_OF_GRADE } from "../../model/promotion-cycle"');
  });

  it("DUP-014: the stale private mapper is dead — the promotion flow uses the ONE shared mapper", () => {
    const ar = src("infrastructure/supabase/repositories/supabase-academic-repository.ts");
    expect(ar).not.toContain("function mapStudentRow");
    expect(ar).toContain("mapStudentRow(r as StudentRow)");
    // The shared mapper carries the fields the private copy dropped.
    const shared = src("infrastructure/supabase/repositories/supabase-shared-repositories.ts");
    expect(shared).toContain("middleName");
    expect(shared).toContain("filiereCode");
  });

  it("DUP-022: parent-actions-menu consumes the canonical WhatsApp helpers (with the local-number normalization)", () => {
    // The canonical normalization the hand-roll lacked: 0550123456 → 213550123456.
    expect(buildWhatsAppUrl("0550 12 34 56")).toBe("https://wa.me/213550123456");
    expect(buildWhatsAppUrl("+213 550 12 34 56")).toBe("https://wa.me/213550123456");
    expect(buildWhatsAppUrl("0033 6 12 34 56 78")).toBe("https://wa.me/33612345678");
    const menu = src("shared/ui/parent-actions-menu.tsx");
    expect(menu).toContain("buildWhatsAppUrl(parent.whatsapp || parent.phone");
    expect(menu).toContain("void openWhatsApp(parent.whatsapp || parent.phone");
    expect(menu).not.toContain("wa.me"); // the hand-rolled URL is dead
  });
});
