/**
 * T-408 (ACAD-509) — the synthetic academic-year purge, source guards.
 *
 * The concurrent 89th-session implementation closed ACAD-506 (the al-* uuid)
 * but the YEAR context kept its own synthetic layer: the hook's
 * FALLBACK_ACADEMIC_YEAR_ID ("ay-2025-2026") fabricated a year id for every
 * creation payload when no year was flagged current, the class dialog
 * carried the stale `academicYear: "2025-2026"` literal (workstream A's
 * "remove stale literal-year payload assumptions"), the grade-entry payload
 * fed a fake year string to the PERSISTED assessments.academic_year column,
 * mapSubjectRow fabricated "ay-2025-2026" onto every year-agnostic subject
 * row (the table has NO academic_year_id column — ADR-018), and the homework
 * push fell back to the stale year code.
 *
 * These guards pin that no synthetic year id/code returns in production
 * paths — a regression fails the suite instead of silently re-fabricating
 * academic context.
 *
 * Sanctioned remainders (documented, NOT violations):
 *  - `src/infrastructure/mock/**` — the mock/dev-mode boundary
 *    (VITE_USE_SUPABASE=false); mock seeds carry their own ids by design
 *    and are unreachable from production provider wiring (T-408 census).
 *  - `src/tests/**`, `src/test/**` — test fixtures.
 *  - year-string PARSERS (analytics-derivations) that compute date windows
 *    from codes — they never fabricate a year, they interpret one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "tests") continue;
      if (entry.name === "mock") continue; // sanctioned dev-mode boundary
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Strip comments so guards ban CODE literals, not documentation that
 * quotes the banned literal (the file headers explaining the purge).
 * Conservative: block comments first, then line comments (a leading
 * character class keeps `https://` inside strings intact).
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

function productionFiles(): string[] {
  return walk(ROOT);
}

describe("T-408 (ACAD-509) — the synthetic academic-year purge (source guards)", () => {
  it("the hook exports NO fallback year constants and returns the honest null contract", () => {
    const hook = stripComments(
      readFileSync(
        join(ROOT, "features/academics/hooks/use-current-academic-year.ts"),
        "utf8",
      ),
    );
    expect(hook).not.toContain("FALLBACK_ACADEMIC_YEAR_ID");
    expect(hook).not.toContain("FALLBACK_ACADEMIC_YEAR_CODE");
    expect(hook).not.toContain('"ay-2025-2026"');
    expect(hook).not.toContain('"2025-2026"');
    // The honest contract: null when no current year is flagged.
    expect(hook).toContain("readonly id: string | null");
    expect(hook).toContain("readonly code: string | null");
    expect(hook).toContain("current?.id ?? null");
  });

  it("no production file fabricates the mock-era year id \"ay-2025-2026\"", () => {
    const offenders: string[] = [];
    for (const file of productionFiles()) {
      const text = stripComments(readFileSync(file, "utf8"));
      if (text.includes('"ay-2025-2026"') || text.includes("'ay-2025-2026'")) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the class dialog derives academicYear from the canonical current year (no stale literal)", () => {
    const dialog = stripComments(
      readFileSync(
        join(ROOT, "features/academics/grade-levels-class-view.tsx"),
        "utf8",
      ),
    );
    expect(dialog).not.toContain('academicYear: "2025-2026"');
    expect(dialog).toContain("academicYear: currentYear.code");
    // The year guard: a missing current year blocks creation with a clean
    // error BEFORE any payload is built.
    expect(dialog).toContain("!currentYear.id || !currentYear.code");
  });

  it("the grade-entry payload never writes the stale year literal to assessments.academic_year", () => {
    const screen = readFileSync(
      join(ROOT, "features/academics/grade-entry-screen.tsx"),
      "utf8",
    );
    expect(screen).not.toContain('?? "2025-2026"');
    // The honest chain: the class's canonical year → the current year → "".
    expect(screen).toContain("cls?.academicYear ?? currentYear.code ?? \"\"");
  });

  it("mapSubjectRow maps year-agnostic identity honestly (no fabricated year scoping)", () => {
    const repo = stripComments(
      readFileSync(
        join(
          ROOT,
          "infrastructure/supabase/repositories/supabase-academic-repository.ts",
        ),
        "utf8",
      ),
    );
    // The subjects table has NO academic_year_id column (ADR-018) — the
    // mapper must not fabricate one.
    expect(repo).not.toContain('row.academic_year_id ?? "ay-2025-2026"');
    expect(repo).not.toContain('row.academic_year_code ?? "2025-2026"');
    // The class mapper's static mock default is gone too.
    expect(repo).not.toContain('?? "2025-2026",');
    // The homework push resolves the year from the academic_years row or
    // maps to the honest empty string.
    expect(repo).toContain('yearRow?.code ?? yearRow?.label ?? ""');
  });

  it("every year-scoped creation surface guards the missing-current-year case", () => {
    const guarded = [
      "features/academics/grade-levels-class-view.tsx",
      "features/academics/teachers-tab.tsx",
      "features/academics/clubs/clubs-tab.tsx",
      "features/academics/therapy/psychology-tab.tsx",
      "features/academics/therapy/orthophonie-tab.tsx",
      "features/academics/subject-configurations-panel.tsx",
      "features/academics/timetable/timetable-tab.tsx",
    ];
    for (const rel of guarded) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(
        text.includes("!currentYear.id") || text.includes("!year.id") || text.includes("!yearId || !yearCode"),
        `${rel} must guard the missing-current-year case (T-408 ACAD-509)`,
      ).toBe(true);
    }
  });

  it("the academic-year drawer derives year subjects from subject_configurations (ADR-018)", () => {
    const drawer = readFileSync(
      join(ROOT, "features/academics/academic-year-detail-drawer.tsx"),
      "utf8",
    );
    // The old mock-era denormalization filter is gone from BOTH sub-tabs.
    expect(drawer).not.toContain("s.academicYearId === year.id");
    // The ADR-018 derivation: identity joined to its contextual
    // configurations for the year — exactly the two sub-tabs (Overview +
    // Subjects).
    expect(drawer.match(/subjectConfigurations\.some/g)?.length).toBe(2);
  });
});
