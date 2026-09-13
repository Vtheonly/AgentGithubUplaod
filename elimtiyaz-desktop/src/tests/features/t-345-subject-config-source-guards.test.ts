/**
 * T-345 (MATIERE-500 / ADR-018) — source-scan guards for the canonical
 * subject architecture. The fourteen scattered coefficient fallback chains
 * (`a.coefficient || subject?.coefficient || 1`) are replaced by the ONE
 * canonical resolver (`resolveSubjectConfiguration`). This guard pins that
 * no NEW fallback chain reappears in the feature/calc layer — a regression
 * fails the suite instead of silently re-forking the resolution rule.
 *
 * Sanctioned remainders (documented, NOT violations):
 *  - `subject-config.ts` itself (the resolver's own legacy layers);
 *  - the vault-compliance test fixtures (`partial.coefficient ?? 4` —
 *    test data, not production resolution);
 *  - `gpa.ts` / `academic-tab.tsx` / `operational-query-engine.ts` keep
 *    `a.coefficient ||` as the SNAPSHOT-first read (the snapshot IS the
 *    resolution for historical rows) — the right side of `||` is the
 *    resolver, never a bare directory read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..", "src");

/** The banned pattern: a directory-coefficient fallback that ends in a
 *  bare `|| 1` / `?? 1` instead of routing through the resolver. */
const BANNED = [
  /coefficient\s*\|\|\s*subject\?\.\s*coefficient\s*\|\|\s*1/,
  /coefficient\s*\|\|\s*subj\?\.\s*coefficient\s*\|\|\s*1/,
  /coefficient\s*\|\|\s*s\?\.\s*coefficient\s*\|\|\s*1/,
  /coefficient\s*\?\?\s*subject\?\.\s*coefficient\s*\?\?\s*1/,
  /cs\.coefficient\s*\|\|\s*[a-z?]*\.?\s*coefficient\s*\|\|\s*1/,
  /coefficient\s*\|\|\s*selectedSubj\?\.\s*coefficient\s*\|\|\s*1/,
  /coefficient\s*=\s*Number\([a-z.]*coefficient\s*\?\?\s*[a-z?.]*coefficient\s*\?\?\s*1\)/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "tests") continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe("T-345 — the canonical subject-configuration resolver (source guards)", () => {
  it("no coefficient fallback chain survives outside the sanctioned modules", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = file.slice(ROOT.length + 1);
      // Sanctioned modules.
      if (rel.includes("domain/calc/academics/subject-config.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const re of BANNED) {
        if (re.test(text)) {
          offenders.push(`${rel}: ${re.source}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the resolver module exists and exports the canonical surface", () => {
    const mod = readFileSync(join(ROOT, "domain/calc/academics/subject-config.ts"), "utf8");
    expect(mod).toContain("export function resolveSubjectConfiguration");
    expect(mod).toContain("export function computeSubjectAverageFromRecipe");
  });

  it("the SubjectConfiguration domain model + the cc mark are pinned", () => {
    const model = readFileSync(join(ROOT, "domain/model/academic.ts"), "utf8");
    expect(model).toContain("export interface SubjectConfiguration");
    expect(model).toContain("export const DEFAULT_GRADING_RECIPE");
    // The contrôle continu mark is part of the Assessment contract.
    expect(model).toContain("readonly cc: number | null;");
  });

  it("both repositories expose the configuration surface", () => {
    const iface = readFileSync(join(ROOT, "domain/repository/academic-repository.ts"), "utf8");
    expect(iface).toContain("observeConfigurations(): Observable<SubjectConfiguration[]>");
    expect(iface).toContain("upsertSubjectConfiguration(");
    const supabase = readFileSync(
      join(ROOT, "infrastructure/supabase/repositories/supabase-academic-repository.ts"),
      "utf8",
    );
    expect(supabase).toContain("from(\"subject_configurations\")");
    const mock = readFileSync(
      join(ROOT, "infrastructure/mock/repositories/academic-repository.ts"),
      "utf8",
    );
    expect(mock).toContain("observeConfigurations(): Observable<SubjectConfiguration[]>");
  });

  it("the grade-entry screen writes the snapshot (recipe + coefficient) on every row", () => {
    const screen = readFileSync(join(ROOT, "features/academics/grade-entry-screen.tsx"), "utf8");
    expect(screen).toContain("coefficientDevoir1: recipe.devoir1");
    expect(screen).toContain("coefficientCc: recipe.cc");
    expect(screen).toContain("coefficient: resolved.coefficient");
    // The cc input renders only when the recipe enables it.
    expect(screen).toContain('recipe.cc > 0');
  });
});
